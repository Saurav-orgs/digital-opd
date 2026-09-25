import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { AppSetting } from '../database/models/app-setting.model';

/** Settings the super admin can change, keyed by name. */
export const SETTING_KEYS = {
  /** Base URL of the patient portal — what a booking QR points at. */
  patientWebBase: 'patient_web_base',

  // Who the subscription invoices are issued by. Settings rather than env
  // vars because they are business facts the super admin owns — a change of
  // registered address must not wait for a deploy — and because an invoice
  // snapshots them at issue, so editing them never rewrites an old invoice.
  invoiceLegalName: 'invoice_legal_name',
  invoiceAddress: 'invoice_address',
  invoiceGstin: 'invoice_gstin',
  invoicePan: 'invoice_pan',
  invoiceState: 'invoice_state',
  invoiceEmail: 'invoice_email',
  invoicePhone: 'invoice_phone',
  /** Prefix of the invoice number series, e.g. MDO in MDO/2026-27/0007. */
  invoicePrefix: 'invoice_prefix',
} as const;

/** The issuer block an invoice is stamped with. */
export interface InvoiceIssuerSettings {
  name: string;
  address: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  prefix: string;
}

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

  /**
   * The issuer block for a new invoice. Anything the super admin has not
   * filled in comes back null and is simply left off the page — an invoice
   * with no GSTIN prints as a plain invoice rather than a tax invoice, which
   * is the honest thing to do until the number is entered.
   */
  invoiceIssuer(): InvoiceIssuerSettings {
    const or = (key: string) => this.get(key).trim() || null;
    return {
      name: this.get(SETTING_KEYS.invoiceLegalName).trim() || 'myDigitalOPD',
      address: or(SETTING_KEYS.invoiceAddress),
      gstin: or(SETTING_KEYS.invoiceGstin),
      pan: or(SETTING_KEYS.invoicePan),
      state: or(SETTING_KEYS.invoiceState),
      email: or(SETTING_KEYS.invoiceEmail),
      phone: or(SETTING_KEYS.invoicePhone),
      prefix: this.get(SETTING_KEYS.invoicePrefix).trim().toUpperCase() || 'MDO',
    };
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    await this.model.upsert({ key, value: trimmed } as any);
    this.cache.set(key, trimmed);
  }

  /** Everything the settings screen shows. */
  async all(): Promise<Record<string, string>> {
    return {
      [SETTING_KEYS.patientWebBase]: this.patientWebBase(),
      [SETTING_KEYS.invoiceLegalName]: this.get(SETTING_KEYS.invoiceLegalName),
      [SETTING_KEYS.invoiceAddress]: this.get(SETTING_KEYS.invoiceAddress),
      [SETTING_KEYS.invoiceGstin]: this.get(SETTING_KEYS.invoiceGstin),
      [SETTING_KEYS.invoicePan]: this.get(SETTING_KEYS.invoicePan),
      [SETTING_KEYS.invoiceState]: this.get(SETTING_KEYS.invoiceState),
      [SETTING_KEYS.invoiceEmail]: this.get(SETTING_KEYS.invoiceEmail),
      [SETTING_KEYS.invoicePhone]: this.get(SETTING_KEYS.invoicePhone),
      [SETTING_KEYS.invoicePrefix]: this.get(SETTING_KEYS.invoicePrefix),
    };
  }
}
