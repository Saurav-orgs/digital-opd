export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  clinicTimezone: string;
  clinic: { name: string; address: string; phone: string; email: string };
  /** Base URL of the patient web app (no trailing slash), used to build QR URLs. */
  patientWebBase: string;
  bookingWindowDays: number;
  maxUploadSizeMb: number;
  jwt: { secret: string; expiresIn: string };
  superAdmin: { email: string; password: string; name: string };
  ai: { url: string; timeoutSeconds: number; enabled: boolean };
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
    url: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
    // Transcribing a long consultation on CPU genuinely takes minutes.
    timeoutSeconds: parseInt(process.env.AI_TIMEOUT_SECONDS || '900', 10),
    // Lets a deployment run with no AI at all; features degrade, nothing breaks.
    enabled: process.env.AI_ENABLED !== 'false',
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
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL_SECONDS || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '20', 10),
  },
});
