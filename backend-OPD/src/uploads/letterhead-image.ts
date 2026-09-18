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
