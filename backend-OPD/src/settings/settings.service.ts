import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { AppSetting } from '../database/models/app-setting.model';

/** Settings the super admin can change, keyed by name. */
export const SETTING_KEYS = {
  /** Base URL of the patient portal — what a booking QR points at. */
  patientWebBase: 'patient_web_base',
} as const;

/**
 * Platform settings, cached in memory.
 *
 * Cached because the patient portal's base URL is read on every doctor
 * serialisation — `toView` builds a booking link for each row of the doctors
 * list — and that is a synchronous method. A database round trip per doctor to
 * fetch a value that changes a handful of times a year is not a trade worth
 * making, so the table is read once at boot and on every write.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, string>();

  constructor(
    @InjectModel(AppSetting) private readonly model: typeof AppSetting,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    try {
      const rows = await this.model.findAll();
      this.cache.clear();
      for (const row of rows) {
        if (row.value != null) this.cache.set(row.key, row.value);
      }
    } catch (err) {
      // Never block boot on this: every read falls back to the env default.
      this.logger.warn(`Could not load app settings: ${(err as Error).message}`);
    }
  }

  /** Synchronous read. Falls back to the env default when unset. */
  get(key: string, fallback = ''): string {
    return this.cache.get(key) || fallback;
  }

  /**
   * The patient portal's base URL, trailing slash removed.
   *
   * Precedence: the admin's setting, then the deploy's env var. A doctor's own
   * `profile_base_url` overrides both, and that is applied by the caller.
   */
  patientWebBase(): string {
    const value =
      this.get(SETTING_KEYS.patientWebBase) ||
      this.config.get<string>('patientWebBase') ||
      '';
    return value.replace(/\/+$/, '');
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    await this.model.upsert({ key, value: trimmed } as any);
    this.cache.set(key, trimmed);
  }

  /** Everything the settings screen shows. */
  async all(): Promise<Record<string, string>> {
    return { [SETTING_KEYS.patientWebBase]: this.patientWebBase() };
  }
}
