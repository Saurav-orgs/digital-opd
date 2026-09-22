/**
 * The prescription page's header geometry, mirrored from
 * `backend-OPD/src/prescriptions/prescription-pdf.service.ts` so the admin
 * can show a doctor the shape their header will print at — and size the
 * handwriting pad to the body it leaves — without asking the server.
 * Change one, change the other.
 */

/** A4 content width in points (595.28 − 2 × 44). */
export const CONTENT_W_PT = 507.28;

/**
 * The least wide-for-its-height a header may be. The PDF draws the header
 * across the full content width with its height to match, so this is what
 * caps the height: at 3 : 1 it takes a third of the width (≈ 6 cm on A4).
 * Backend: `HEADER_MIN_RATIO` in `uploads/letterhead-image.ts`.
 */
export const MIN_RATIO = 3;

/** The box headers uploaded before their shape was measured still print in. */
export const LEGACY_HEADER_PT = 90;
/** That box's shape (2000 × 355 px), for previews of a legacy header. */
export const LEGACY_RATIO = CONTENT_W_PT / LEGACY_HEADER_PT;

/** How tall a header of this width ÷ height prints, in points. */
export function headerHeightPt(ratio: number | null | undefined): number {
  if (!ratio || ratio <= 0) return LEGACY_HEADER_PT;
  return Math.min(CONTENT_W_PT / ratio, CONTENT_W_PT / MIN_RATIO);
}

/**
 * How much of the issued page is left for the body below a header of this
 * shape: from under the patient row to the top of the rebook block. The
 * fixed parts are the PDF's own constants (header top 40, gap 12, rule
 * 4.5 + 22, patient row ≈ 55, page 841.89 − footer 75 − rebook 100 − 12);
 * the patient row is text and can differ by a point, which the PDF's
 * fit-scaling absorbs.
 */
export function bodyHeightPt(ratio: number | null | undefined): number {
  const bodyTop = 40 + headerHeightPt(ratio) + 12 + 26.5 + 55;
  const bodyBottom = 841.89 - 75 - 100 - 12;
  return bodyBottom - bodyTop;
}
