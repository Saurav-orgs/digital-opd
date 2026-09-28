import { useState } from 'react';
import type { RefObject } from 'react';
import { HeaderCropper } from './HeaderCropper';
import { LEGACY_RATIO, MIN_RATIO } from '../lib/letterhead';

export { MIN_RATIO } from '../lib/letterhead';

/**
 * The width a header should be uploaded at. Height is the doctor's own — the
 * PDF box is sized to the image (see `lib/letterhead.ts`) — so only the width
 * matters for print quality: 2000 px across the page's 507 pt is ~280 dpi.
 */
export const HEADER_MIN_W = 1000;
export const HEADER_BEST_W = 2000;

/** What the file input accepts: any image, or the printer's PDF of the pad. */
export const HEADER_ACCEPT = 'image/*,application/pdf';

/**
 * The pixel size of an image file, or null when the browser cannot decode it
 * (TIFF, HEIC outside Safari, or a PDF — those go to the cropper, which
 * draws them itself).
 */
function measureImage(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * The hidden file input behind an "Upload header" button, and the cropper it
 * opens. Shared by the letterhead screen and the registration form so both
 * take the same files the same way.
 *
 * Two kinds of file arrive: a strip a doctor has already cut out of their
 * pad, and the whole pad — a scan, a phone photo or the printer's PDF. A
 * strip (at least `MIN_RATIO` wide for its height) goes straight to `onPick`.
 * Anything else opens `HeaderCropper`, and `onPick` gets the strip the doctor
 * marked. Either way `onPick` only ever sees a file that fits the page, with
 * its shape, so the caller can show it at the proportions it will print at.
 * `onReject` gets the reason for a file that cannot be used at all.
 */
export function LetterheadHeaderPicker({
  inputRef,
  onPick,
  onReject,
}: {
  inputRef: RefObject<HTMLInputElement>;
  onPick: (file: File, ratio: number) => void;
  onReject: (problem: string) => void;
}) {
  const [toCrop, setToCrop] = useState<File | null>(null);

  const accept = async (file: File) => {
    const dims = await measureImage(file);
    if (dims) {
      if (dims.w < HEADER_MIN_W) {
        onReject(
          `This image is only ${dims.w} px wide and would print blurry. ` +
            `Use a scan at least ${HEADER_MIN_W} px wide (${HEADER_BEST_W} px is ideal).`,
        );
        return;
      }
      const ratio = dims.w / dims.h;
      if (ratio >= MIN_RATIO) {
        onPick(file, ratio);
        return;
      }
    }
    setToCrop(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={HEADER_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Reset first so picking the same file again still fires a change.
          e.target.value = '';
          if (!f) return;
          void accept(f);
        }}
      />
      {toCrop && (
        <HeaderCropper
          source={toCrop}
          onCancel={() => setToCrop(null)}
          onCrop={(strip) => {
            setToCrop(null);
            void measureImage(strip).then((dims) => {
              if (!dims) {
                onReject('The header could not be cut out. Please try another file.');
                return;
              }
              onPick(strip, dims.w / dims.h);
            });
          }}
        />
      )}
    </>
  );
}

/** A faithful mini of the PDF letterhead layout. */
export function LetterheadPreview({
  headerUrl, headerRatio, doctorName, qualifications, specialization, address, phone,
}: {
  headerUrl: string | null;
  /** Width ÷ height of the header image; null for one uploaded before it was measured. */
  headerRatio?: number | null;
  doctorName: string;
  qualifications: string;
  specialization: string;
  address: string;
  phone: string;
}) {
  const accent = '#1B6EF3';
  return (
    <div style={{ border: 'var(--hairline)', borderRadius: 8, overflow: 'hidden', background: '#fff', padding: '14px 14px 16px' }}>
      {/* The header: the doctor's own uploaded strip, or their details. */}
      {headerUrl ? (
        <div style={{ aspectRatio: `${headerRatio || LEGACY_RATIO}`, width: '100%' }}>
          <img src={headerUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'left center', display: 'block' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{doctorName}</div>
            {qualifications && <div style={{ fontSize: 10.5, color: '#374151', marginTop: 2 }}>{qualifications}</div>}
            {specialization && <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>{specialization}</div>}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#111827', maxWidth: 140 }}>
            <div>{address || 'Address'}</div>
            {phone && <div style={{ fontSize: 10, fontWeight: 400, color: '#6B7280', marginTop: 2 }}>{phone}</div>}
          </div>
        </div>
      )}

      {/* The blue rule under the header — this is what separates the pad from
          the patient's sheet; on a print copy the header above is left blank. */}
      <div style={{ height: 3.5, background: accent, borderRadius: 2, marginTop: 10 }} />

      {/* Patient info row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>Patient Name</div>
          <div style={{ fontSize: 10, color: '#374151', marginTop: 1 }}>Patient Name (Age yrs, Gender)</div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#111827' }}>
          Date
        </div>
      </div>

      {/* Body sections, in the order the PDF prints them */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#111827', letterSpacing: 0.3 }}>DIAGNOSIS</div>
        <div style={{ fontSize: 9.5, color: '#6B7280', marginTop: 3, fontStyle: 'italic' }}>Diagnosis appears here.</div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#111827', letterSpacing: 0.3 }}>TREATMENT ADVICE</div>
        <div style={{ fontSize: 9.5, color: '#6B7280', marginTop: 3, fontStyle: 'italic' }}>Medicines appear here.</div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#111827', letterSpacing: 0.3 }}>ADVICE</div>
        <div style={{ fontSize: 9.5, color: '#6B7280', marginTop: 3, fontStyle: 'italic' }}>General advice and follow-up date appear here.</div>
      </div>

      {/* Booking QR, pinned above the footer */}
      <div style={{ marginTop: 22, borderTop: '0.5px solid #E5E7EB', paddingTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 3, background: 'repeating-linear-gradient(90deg,#111827 0 3px,transparent 3px 6px), repeating-linear-gradient(0deg,#111827 0 3px,transparent 3px 6px)', backgroundBlendMode: 'multiply', opacity: 0.85 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: '#111827' }}>Book your next appointment</div>
          <div style={{ fontSize: 8, color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Scan the code or open the booking link</div>
        </div>
      </div>

      {/* Bottom disclaimer & blue bar */}
      <div style={{ marginTop: 10, borderTop: '0.5px solid #E5E7EB', paddingTop: 6, textAlign: 'center' }}>
        <div style={{ fontSize: 8, fontStyle: 'italic', color: '#9CA3AF' }}>
          *This is a digitally signed prescription and does not require signature.*
        </div>
        <div style={{ height: 3.5, background: accent, borderRadius: 2, marginTop: 6 }} />
      </div>
    </div>
  );
}
