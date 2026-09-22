import sharp from 'sharp';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/** What pdfkit can embed as-is; anything else is converted to PNG first. */
const EMBEDDABLE = ['image/png', 'image/jpeg'];

/**
 * Sniffed by extension when the browser sends no useful type — some phones
 * label a HEIC or a WebP `application/octet-stream`.
 */
const IMAGE_EXT = /\.(png|jpe?g|jfif|webp|gif|bmp|tiff?|svg|avif|heic|heif)$/i;

/**
 * Makes a letterhead header image safe to put on a prescription.
 *
 * Doctors send whatever their scanner or phone produced — WebP, GIF, TIFF,
 * BMP, SVG, a JPEG with a `.jfif` name. The PDF generator can only embed PNG
 * and JPEG, so a file already in one of those goes through untouched and
 * anything else is re-encoded to PNG here, at upload time, where a broken
 * file can still be refused with a message the doctor sees. Failing at the
 * first prescription instead would be too late.
 *
 * Multer's file shape is kept so the caller stores the result exactly as it
 * would have stored the original.
 */
export async function toEmbeddableImage(
  file: Express.Multer.File,
): Promise<Express.Multer.File> {
  if (EMBEDDABLE.includes(file.mimetype)) return file;
  const looksLikeImage =
    file.mimetype.startsWith('image/') || IMAGE_EXT.test(file.originalname ?? '');
  if (!looksLikeImage) {
    throw new AppException(ErrorCode.UNSUPPORTED_FILE_TYPE, {
      message: 'The letterhead header must be an image (PNG, JPG, WebP, GIF, BMP, TIFF or SVG).',
    });
  }
  let buffer: Buffer;
  try {
    // A GIF's first frame; the PNG keeps transparency, and `sharp` reads
    // EXIF orientation so a phone photo is not embedded on its side.
    buffer = await sharp(file.buffer, { animated: false }).rotate().png().toBuffer();
  } catch {
    throw new AppException(ErrorCode.UNSUPPORTED_FILE_TYPE, {
      message:
        'This image could not be read. Please save it as a PNG or JPG and try again.',
    });
  }
  return {
    ...file,
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
    originalname: (file.originalname ?? 'letterhead').replace(/\.[^.]*$/, '') + '.png',
  };
}

/**
 * The least wide-for-its-height a header may be. The PDF draws the header
 * across the full content width with its height to match, so this is what
 * caps the height: at 3 : 1 the header takes a third of the page's width in
 * height (≈ 6 cm on A4), about a fifth of the sheet. Mirrored in the admin
 * (`components/Letterhead.tsx`), where the cropper will not let a doctor cut
 * a taller strip than this.
 */
export const HEADER_MIN_RATIO = 3;

/** Narrower than this prints visibly soft at the header's full-width size. */
const HEADER_MIN_WIDTH = 1000;

/**
 * A header image ready to store, with the shape the PDF needs to size it.
 *
 * On top of `toEmbeddableImage`: the white border a scanner or a phone photo
 * leaves around the pad is trimmed away — the header is drawn edge to edge,
 * and a border would print as a narrower, off-centre strip — and the result
 * is measured. Too tall a strip is refused here, on the server, whatever the
 * browser checked: the PDF would otherwise have to shrink it to fit and the
 * doctor's details would print unreadable.
 */
export async function prepareHeaderImage(
  file: Express.Multer.File,
): Promise<{ file: Express.Multer.File; ratio: number }> {
  const embeddable = await toEmbeddableImage(file);
  let buffer: Buffer;
  let width: number | undefined;
  let height: number | undefined;
  try {
    // `rotate()` bakes in EXIF orientation, which the re-encode drops — a
    // JPEG straight from a phone would otherwise embed on its side. The
    // trim threshold is generous so off-white scanner backgrounds and JPEG
    // noise count as border; the pad's own art is far darker than this.
    const trimmed = sharp(embeddable.buffer).rotate().trim({ threshold: 40 });
    const { data, info } = await trimmed.toBuffer({ resolveWithObject: true });
    buffer = data;
    width = info.width;
    height = info.height;
  } catch {
    // `trim` throws on an image that is entirely one colour, which is not a
    // header either way — fall through to the measurement below and let the
    // shape checks say so.
    buffer = embeddable.buffer;
    const meta = await sharp(buffer).metadata().catch(() => ({} as { width?: number; height?: number }));
    width = meta.width;
    height = meta.height;
  }
  if (!width || !height) {
    throw new AppException(ErrorCode.UNSUPPORTED_FILE_TYPE, {
      message: 'This image could not be read. Please save it as a PNG or JPG and try again.',
    });
  }
  const ratio = width / height;
  if (ratio < HEADER_MIN_RATIO) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, {
      message:
        `This image is ${width} × ${height} px — too tall for the header strip. ` +
        `It needs to be at least ${HEADER_MIN_RATIO} times wider than it is tall. ` +
        `Crop it to just the top of your pad and try again.`,
    });
  }
  if (width < HEADER_MIN_WIDTH) {
    throw new AppException(ErrorCode.VALIDATION_FAILED, {
      message:
        `This image is only ${width} px wide and would print blurry. ` +
        `Use a scan at least ${HEADER_MIN_WIDTH} px wide.`,
    });
  }
  return {
    file: { ...embeddable, buffer, size: buffer.length },
    ratio: Math.round(ratio * 1000) / 1000,
  };
}
