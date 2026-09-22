# Letterhead Header — Flexible Height + Crop-on-Upload

Two problems with the current header upload, one plan.

1. **The header box is a fixed 507 × 90 pt** (`HEADER_BOX` in
   `prescription-pdf.service.ts`). A dense pad top like Dr. Acharya's
   (≈ 3.4 : 1, 9pt clinic timings) is refused by the 4 : 1 gate, and even if
   allowed would be shrunk to 90 pt and print unreadable.
2. **Doctors have to crop the strip themselves.** They have a scan or the
   printer's PDF of the whole pad; asking them to open an image editor and
   cut out the top is the step where uploads stall.

Scope: **web admin + backend only.** The Flutter app does not reference the
header image anywhere, so nothing there changes.

## Decisions

- **Header-only stays the model.** The PDF never draws a full-page template:
  pre-printed fields on a pad (Name & Address ……, Age/Sex ……) would collide
  with the rows we draw, multi-page and print-on-pad copies would have no
  clear answer, and a full-page scan behind crisp text looks wrong. The
  full page is accepted *as input* and cropped to a strip in the browser.
- **Height follows the image.** `height = CONTENT_W / (w / h)`, capped.
  Width always fills the content width; no image is ever fitted narrower.
- **One cap, one constant.** `MIN_RATIO = 3` (was 4). The tallest header is
  therefore `CONTENT_W / 3 ≈ 169 pt` (≈ 6 cm, 20 % of A4). The cropper will
  not let the doctor pick a strip taller than that, so nothing is rejected
  after cropping. Dr. Acharya's header lands at ≈ 149 pt.
- **Ratio is stored on the doctor, measured on the server.** The backend
  already has `sharp`, so it reads the dimensions at upload (the comment in
  `Letterhead.tsx` saying the server cannot is stale). Stored as one
  column, `letterhead_header_ratio` (w / h). The print copy needs it to leave
  the right blank gap without fetching the image.
- **Legacy rows keep printing as before.** `ratio = null` (uploaded before
  this change) → the old 90 pt box. No backfill needed; re-uploading sets it.
- **White margins are trimmed server-side** (`sharp().trim()`), so a scan
  with a border still prints edge-to-edge. Measured *after* the trim.
- **No new dependencies.** The cropper is pointer events + a canvas;
  `pdfjs-dist` is already in the admin for rasterising a PDF's first page.

## Phase 1 — Backend: header height from the image ✅ DONE

**Migration** `20260922000001-doctor-letterhead-header-ratio.js`
- `doctors.letterhead_header_ratio` FLOAT NULL.

**`uploads/letterhead-image.ts`**
- `prepareHeaderImage(file)` → `{ file, ratio }`: `toEmbeddableImage`, then
  `sharp(buffer).trim({ threshold })` and `.metadata()`. Refuse when
  `w / h < HEADER_MIN_RATIO` ("too tall for the header strip — crop it to the
  top of your pad") or `w < 1000` ("would print blurry"). Trim may drop the
  ratio below the gate for an odd image; that is refused with the same words.
- `HEADER_MIN_RATIO = 3` lives here and is imported by the PDF service.

**`doctors.service.ts`**
- `uploadLetterheadHeader`, `registerSelf`: save `letterhead_header_ratio`
  alongside the key. `removeLetterheadHeader` clears it.
- `toView` exposes `letterhead_header_ratio`.

**`prescription-pdf.service.ts`**
- `HEADER_BOX` → `HEADER_TOP = 40`, `headerHeight(doctor)`:
  `ratio ? min(CONTENT_W / ratio, CONTENT_W / HEADER_MIN_RATIO) : 90`.
- `imageHeader` fits into `[CONTENT_W, headerHeight]`; the print-copy branch
  leaves the same height blank. Both return `HEADER_TOP + h + 12`.
- Nothing else moves: the body already flows from `y`, continuation pages
  are unaffected, handwriting is fit-scaled into whatever is left.

## Phase 2 — Web: crop on upload ✅ DONE

**`components/HeaderCropper.tsx`** (new)
- Modal over the current page. Shows the uploaded image (or page 1 of a PDF,
  rasterised at 3 px/pt) at full width; two horizontal handles — **top** and
  **bottom** of the strip — drag with pointer events; outside the strip is
  dimmed. Defaults: top 0, bottom at 25 % of the image or at the max height
  (`width / MIN_RATIO`), whichever is smaller.
- The bottom handle cannot go lower than `top + width / MIN_RATIO`, so the
  strip always passes the gate. A one-line hint says "drag to just below your
  header; the sheet starts here".
- Beside it a live "prints as" strip at the page's proportions, so what the
  doctor sees is the shape that will print.
- **Use this header** → draws the strip onto a canvas at the image's natural
  resolution → PNG `File` → `onCrop(file)`. Cancel closes.
- A file that is already a strip (ratio ≥ MIN_RATIO) skips the cropper and
  goes straight through — nothing changes for a doctor who has one ready.

**`components/Letterhead.tsx`**
- `MIN_RATIO = 3`. `HEADER_PX` becomes a suggestion, not a mould
  (`2000 px wide`, any height ≥ … ). `checkHeaderImage` only rejects what
  cannot be measured (unreadable format); shape is handled by the cropper.
- `LetterheadHeaderPicker` accepts `image/*,application/pdf`, opens the
  cropper for anything not already a strip, and hands the cropped `File` to
  `onPick`.
- `LetterheadPreview` takes `headerRatio` and sets `aspectRatio` from it
  (fallback 2000 / 355 for legacy rows).

**`pages/Letterhead.tsx`, `pages/DoctorRegister.tsx`**
- Copy updated: "Upload your pad — a scan, photo or the printer's PDF — and
  mark where the header ends." Size hint: at least 1000 px wide.
- `.lh-header-box` aspect ratio comes from the doctor's stored ratio
  (inline style), not the CSS constant.

**`api/types.ts`** — `letterhead_header_ratio?: number | null` on `Doctor`.

## Phase 3 — Web handwriting canvas follows the header ✅ DONE

The canvas is fixed at 515 × 507 pt (`CANVAS_W/H` in `HandwritingCanvas.tsx`)
and the PDF fit-scales the drawing into the body. A tall header shrinks the
body, so the drawing scales down (≈ 12 % at the cap) with air on the sides.
Make the canvas height match the doctor's real body height:

- Export `bodyHeightPt(headerRatio)` from `Letterhead.tsx`, mirroring the
  PDF's arithmetic (header top + height + rule + patient row → body bottom).
- `HandwritingCanvas` takes `bodyHeightPt` (from `doctor-me`), sizes its
  backing canvas to `2 × 515 × bodyHeightPt`. Existing saved pages load into
  the canvas unchanged (`drawImage` scales them).

Low risk, small; done last so phases 1–2 ship on their own if needed.

## Not in this plan

- **Footer strip** (some pads carry address/timings at the bottom). Same
  mechanism — a second crop, drawn above our disclaimer bar — but it changes
  the frame arithmetic (`FOOTER_TOP`, `PRINT_FOOTER_LIFT`) and deserves its
  own pass. Flag for the client.
- Flutter profile screen: does not show the header today; when it does, it
  should read `letterhead_header_ratio` for the preview box.
- Backfilling `letterhead_header_ratio` for existing uploads. Legacy rows
  print exactly as they do now; a re-upload sets it.

## Verification (22 Sep 2026)

Done: cropper driven in the browser with Dr. Acharya's full page (JPG and a
PDF of it) → 1180 × 334 strip, ratio 3.53; a pre-cropped strip skipped the
cropper; phone width fine. `prepareHeaderImage` + `render()` run through the
real service with stubbed storage: measured header ≈ 150 pt and legible,
print copy leaves the same gap, `ratio = null` prints in the old 90 pt box.
Not yet exercised end to end: a real upload through `/doctors/me/letterhead-header`
and a handwritten prescription on the resized pad — needs a signed-in doctor.

### Checklist

- Backend typecheck; upload Dr. Acharya's full page → cropper → strip →
  `letterhead_header_ratio ≈ 3.4`; issue a prescription → header ≈ 149 pt,
  legible; print copy leaves the same gap; a legacy doctor (ratio null)
  renders unchanged.
- Upload an already-cropped 2000 × 355 strip → cropper skipped, prints as
  before at 90 pt.
- Upload the printer's PDF → page 1 rasterised → cropper.
- Handwritten prescription with a tall header → canvas taller in the web
  editor, drawing fills the body in the PDF without side gaps.
