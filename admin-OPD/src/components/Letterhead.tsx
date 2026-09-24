import type { RefObject } from 'react';

/**
 * A comfortable pixel size for a header: 2000px wide prints crisply across
 * the page's content width (507pt), and 355px tall is the classic thin
 * strip. It is a suggestion, not a mould — the PDF takes the header's height
 * from the image itself, so a deeper hospital pad top prints deeper.
 */
export const HEADER_PX = { w: 2000, h: 355 };

/**
 * The least wide-for-its-height a header may be. The PDF draws the header
 * across the full content width (507pt) and will let it run up to 220pt
 * deep — 2.3 : 1 — before capping it. Anything at least this wide therefore
 * prints edge to edge at its own proportions; a squarer image (a whole
 * scanned page, say) would be shrunk to that depth and print as a small
 * block, so it is refused with a note to crop it to the pad's top.
 */
export const MIN_RATIO = 2.3;

/**
 * Why a file will not do as the header, or null when it will.
 *
 * The header is a band, not a mould: a doctor's own pad top will not be
 * exactly our pixels, and need not be — it prints at its own height. Two
 * things are refused — an image too tall for its width (see `MIN_RATIO`),
 * which is usually a whole page rather than its letterhead, and one too
 * narrow to print sharply. Checked in the browser, with the file in hand, so
 * the doctor hears about it at the moment they pick the file.
 */
export function checkHeaderImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w / h < MIN_RATIO) {
        resolve(
          `This image is ${w} × ${h} px — too tall for the top of the page. It needs to be at ` +
            `least ${MIN_RATIO} times wider than it is tall (${Math.round(w / MIN_RATIO)} px tall ` +
            `or less at this width). Crop it to just the letterhead at the top of your pad — ` +
            `leave out the blank space below it — and try again.`,
        );
      } else if (w < HEADER_PX.w / 2) {
        resolve(
          `This image is only ${w} px wide and would print blurry. ` +
            `Use one at least ${HEADER_PX.w / 2} px wide (${HEADER_PX.w} × ${HEADER_PX.h} px is ideal).`,
        );
      } else {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // The shape check needs the browser to decode the file; a format it
      // cannot show (TIFF, HEIC outside Safari) cannot be measured here.
      resolve(
        'Your browser cannot open this image format. Save it as a PNG or JPG and try again.',
      );
    };
    img.src = url;
  });
}

/**
 * The hidden file input behind an "Upload header" button, with the shape
 * check already applied: `onPick` only ever sees a file that will fit the
 * box, `onReject` gets the reason for one that will not. Shared by the
 * letterhead screen and the registration form so both refuse the same files
 * with the same words.
 */
export function LetterheadHeaderPicker({
  inputRef,
  onPick,
  onReject,
}: {
  inputRef: RefObject<HTMLInputElement>;
  onPick: (file: File) => void;
  onReject: (problem: string) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        // Reset first so picking the same file again still fires a change.
        e.target.value = '';
        if (!f) return;
        void checkHeaderImage(f).then((problem) => {
          if (problem) onReject(problem);
          else onPick(f);
        });
      }}
    />
  );
}

/** A faithful mini of the PDF letterhead layout. */
export function LetterheadPreview({
  headerUrl, doctorName, qualifications, specialization, address, phone,
}: {
  headerUrl: string | null;
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
        // Full width at the image's own height, exactly as the PDF draws it.
        <img src={headerUrl} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
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
