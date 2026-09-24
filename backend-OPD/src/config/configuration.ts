export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  clinicTimezone: string;
  clinic: { name: string; address: string; phone: string; email: string };
  /** Base URL of the patient web app (no trailing slash), used to build QR URLs. */
  patientWebBase: string;
  /** Base URL of the admin web app (no trailing slash): the sign-in link in staff emails. */
  adminWebBase: string;
  /** Base URL of the landing / sign-up site (no trailing slash): where Cashfree sends the doctor back. */
  landingWebBase: string;
  /**
   * This API's own public base including the prefix (no trailing slash),
   * for links that must open without a login — the prescription link a
   * doctor sends over WhatsApp.
   */
  apiPublicBase: string;
  /**
   * Outgoing mail. `user` empty means "no mailer": messages are written to
   * the log instead of sent, so a developer machine needs no SMTP account
   * and the verification / reset flows still work end to end.
   */
  mail: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  /**
   * WhatsApp Cloud API (Meta Graph). Sends the one-time code a patient
   * must type to open an account. `accessToken` empty means "no sender":
   * the code is written to the log instead, so a developer machine can walk
   * through patient registration without a Meta business account.
   */
  whatsapp: {
    accessToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    appId: string;
    appSecret: string;
    verifyToken: string;
    apiVersion: string;
    /** Country code prefixed to the 10-digit number the patient types. */
    countryCode: string;
    /** Name and language of the approved AUTHENTICATION template. */
    otpTemplate: string;
    otpTemplateLang: string;
  };
  /**
   * Cashfree Payment Gateway, which takes the subscription payment at sign-up.
   * `env` picks the sandbox or the live API; the app id and secret come from
   * the matching Cashfree dashboard. `notifyUrl` is the webhook Cashfree
   * calls — it must be reachable from the internet and match what the
   * dashboard has.
   */
  cashfree: {
    appId: string;
    secretKey: string;
    env: 'sandbox' | 'production';
    apiVersion: string;
    notifyUrl: string;
  };
  /** GST charged on top of every plan, as a percentage. */
  gstRatePercent: number;
  /**
   * The old free self-registration (`POST /doctors/register`). Off by
   * default now that sign-up is paid — left in so a deployment without
   * plans can switch it back on.
   */
  selfRegistrationOpen: boolean;
  bookingWindowDays: number;
  maxUploadSizeMb: number;
  jwt: { secret: string; expiresIn: string };
  superAdmin: { email: string; password: string; name: string };
  ai: { url: string; timeoutSeconds: number; enabled: boolean; streaming: boolean };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    ssl: boolean;
    logging: boolean;
  };
  s3: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    urlPrefix: string;
    baseFolder: string;
    appFolder: string;
  };
  throttle: { ttl: number; limit: number };
}

/** `API_PUBLIC_BASE` with the API prefix taken off — the origin a route outside the prefix hangs on. */
const publicOrigin = (): string => {
  const prefix = process.env.API_PREFIX || 'api';
  const base =
    process.env.API_PUBLIC_BASE || `http://localhost:${process.env.PORT || '3000'}/${prefix}`;
  return base.replace(new RegExp(`/${prefix}/?$`), '');
};

export default (): AppConfig => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api',
  clinicTimezone: process.env.CLINIC_TIMEZONE || 'Asia/Kolkata',
  // Branding for the prescription letterhead. All optional — the header
  // falls back to the doctor's own name when the clinic name is unset.
  clinic: {
    name: process.env.CLINIC_NAME || '',
    address: process.env.CLINIC_ADDRESS || '',
    phone: process.env.CLINIC_PHONE || '',
    email: process.env.CLINIC_EMAIL || '',
  },
  patientWebBase: process.env.PATIENT_WEB_BASE || 'http://localhost:5174',
  adminWebBase: process.env.ADMIN_WEB_BASE || 'http://localhost:5173',
  landingWebBase: process.env.LANDING_WEB_BASE || 'http://localhost:5176',
  apiPublicBase:
    process.env.API_PUBLIC_BASE ||
    `http://localhost:${process.env.PORT || '3000'}/${process.env.API_PREFIX || 'api'}`,
  mail: {
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT || '465', 10),
    // 465 is implicit TLS ("ssl://" in the old PHP config); 587 would be STARTTLS.
    secure: process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : true,
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || process.env.MAIL_USER || 'no-reply@mydigitalopd.in',
  },
  whatsapp: {
    accessToken: process.env.WA_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WA_BUSINESS_ACCOUNT_ID || '',
    appId: process.env.WA_APP_ID || '',
    appSecret: process.env.WA_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    apiVersion: process.env.WA_API_VERSION || 'v21.0',
    countryCode: process.env.WA_COUNTRY_CODE || '91',
    otpTemplate: process.env.WA_OTP_TEMPLATE_NAME || 'otp_verification',
    otpTemplateLang: process.env.WA_OTP_TEMPLATE_LANG || 'en_US',
  },
  cashfree: {
    appId: process.env.CASHFREE_APP_ID || '',
    secretKey: process.env.CASHFREE_SECRET_KEY || '',
    env: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox',
    apiVersion: process.env.CASHFREE_API_VERSION || '2023-08-01',
    // The webhook lives outside the API prefix (see main.ts), so it is the
    // public origin plus a fixed path rather than a route under /api.
    notifyUrl: process.env.CASHFREE_NOTIFY_URL || `${publicOrigin()}/payment/webhook`,
  },
  gstRatePercent: parseFloat(process.env.GST_RATE_PERCENT || '18'),
  selfRegistrationOpen: process.env.SELF_REGISTRATION_OPEN === 'true',
  bookingWindowDays: parseInt(process.env.BOOKING_WINDOW_DAYS || '7', 10),
  maxUploadSizeMb: parseInt(process.env.MAX_UPLOAD_SIZE_MB || '5', 10),
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  superAdmin: {
    email: process.env.SUPERADMIN_EMAIL || 'superadmin@opd.local',
    password: process.env.SUPERADMIN_PASSWORD || 'change-me',
    name: process.env.SUPERADMIN_NAME || 'Super Admin',
  },
  ai: {
    // Local inference sidecar (see ai-OPD/). Never a public URL.
    url: process.env.AI_SERVICE_URL || 'https://onlinepayment.in',
    // Transcribing a long consultation on CPU genuinely takes minutes.
    timeoutSeconds: parseInt(process.env.AI_TIMEOUT_SECONDS || '900', 10),
    // Lets a deployment run with no AI at all; features degrade, nothing breaks.
    enabled: process.env.AI_ENABLED !== 'false',
    // Live transcription over a WebSocket while the doctor is still talking.
    // Off, the recorder uploads the whole recording when they stop, as it
    // always did — the client falls back to that on its own when the socket
    // is refused, so this can be flipped without a client release.
    streaming: process.env.CONSULTATION_STREAMING !== 'false',
  },
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    name: process.env.DATABASE_NAME || 'OPD',
    ssl: process.env.DATABASE_SSL === 'true',
    logging: process.env.DATABASE_LOGGING === 'true',
  },
  s3: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucket: process.env.AWS_S3_BUCKET || '',
    urlPrefix: process.env.AWS_S3_URL_PREFIX || '',
    baseFolder: process.env.AWS_S3_BASE_FOLDER || '',
    appFolder: process.env.AWS_S3_APP_FOLDER || 'opd',
  },
  /**
   * The ceiling for ordinary signed-in traffic, counted per session.
   *
   * One appointment screen legitimately makes half a dozen requests as it
   * opens, and then polls while an AI summary or a transcription is running —
   * so the old 20/minute was tripped by using the product as intended, not by
   * abusing it. The routes that actually need a tight limit (public booking,
   * patient OTP) set their own `@Throttle` of 10/minute and are unaffected by
   * this number.
   */
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL_SECONDS || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '300', 10),
  },
});
