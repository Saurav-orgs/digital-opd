import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** Pathlab reports may also be PDFs, on top of the image allowlist. */
export const ALLOWED_REPORT_MIME = [...ALLOWED_IMAGE_MIME, 'application/pdf'];

export interface StoredFile {
  key: string; // S3 object key (what we persist in the DB)
  url: string; // public/base URL for convenience
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly urlPrefix: string;
  private readonly baseFolder: string;
  private readonly appFolder: string;
  private readonly maxBytes: number;

  constructor(private readonly config: ConfigService) {
    const s3 = this.config.get('s3');
    this.bucket = s3.bucket;
    this.urlPrefix = (s3.urlPrefix || '').replace(/\/$/, '');
    this.baseFolder = (s3.baseFolder || '').replace(/(^\/|\/$)/g, '');
    this.appFolder = (s3.appFolder || '').replace(/(^\/|\/$)/g, '');
    this.maxBytes =
      (this.config.get<number>('maxUploadSizeMb') ?? 5) * 1024 * 1024;
    this.s3 = new S3Client({
      region: s3.region,
      credentials: {
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      },
    });
  }

  /** Validates an image against mime allowlist + size, throwing readable errors. */
  validateImage(file: Express.Multer.File): void {
    this.validateAgainst(file, ALLOWED_IMAGE_MIME);
  }

  /** Validates a pathlab report (image or PDF) against mime allowlist + size. */
  validateDocument(file: Express.Multer.File): void {
    this.validateAgainst(file, ALLOWED_REPORT_MIME);
  }

  private validateAgainst(file: Express.Multer.File, allowlist: string[]): void {
    if (!file) throw new AppException(ErrorCode.FILE_REQUIRED);
    if (!allowlist.includes(file.mimetype)) {
      throw new AppException(ErrorCode.UNSUPPORTED_FILE_TYPE);
    }
    if (file.size > this.maxBytes) {
      throw new AppException(ErrorCode.FILE_TOO_LARGE);
    }
  }

  /**
   * Uploads a validated image to S3 under {baseFolder}/{appFolder}/{folder}/.
   * Returns the object key (persist this) + a base URL.
   */
  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<StoredFile> {
    this.validateImage(file);
    return this.putObject(file, folder);
  }

  /** Uploads a validated pathlab report (image or PDF) to S3. */
  async uploadDocument(
    file: Express.Multer.File,
    folder: string,
  ): Promise<StoredFile> {
    this.validateDocument(file);
    return this.putObject(file, folder);
  }

  private async putObject(
    file: Express.Multer.File,
    folder: string,
  ): Promise<StoredFile> {
    const key = this.buildKey(folder, file.originalname);
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } catch (err) {
      this.logger.error(`S3 upload failed for ${key}`, err as Error);
      throw new AppException(ErrorCode.UPLOAD_FAILED);
    }
    return { key, url: this.publicUrl(key) as string };
  }

  /**
   * Fetches an object's bytes. Used when a stored file has to be re-processed
   * server-side (e.g. re-running an AI summary after the first attempt failed).
   */
  async download(key: string): Promise<Buffer> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      this.logger.error(`S3 download failed for ${key}`, err as Error);
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'The stored file could not be read.',
      });
    }
  }

  async delete(key: string): Promise<void> {
    if (!key) return;
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      // Best-effort cleanup; never fail the caller on delete.
      this.logger.warn(`S3 delete failed for ${key}: ${(err as Error).message}`);
    }
  }

  /** Time-limited GET URL for private objects (web portal viewing). */
  async presignedGetUrl(
    key: string | null,
    expiresInSeconds = 300,
  ): Promise<string | null> {
    if (!key) return null;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  publicUrl(key: string | null): string | null {
    if (!key) return null;
    if (!this.urlPrefix) return key;
    return `${this.urlPrefix}/${key}`;
  }

  private buildKey(folder: string, originalName: string): string {
    const ext = (extname(originalName) || '.jpg').toLowerCase();
    const cleanFolder = folder.replace(/(^\/|\/$)/g, '');
    return [this.baseFolder, this.appFolder, cleanFolder, `${randomUUID()}${ext}`]
      .filter(Boolean)
      .join('/');
  }
}
