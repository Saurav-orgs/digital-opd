export const AppConfig = {
  // Must include the scheme: axios treats a scheme-less baseURL as a path
  // relative to the current origin, which breaks the deployed app.
  apiBaseUrl: 'https://api-digital-opd.devenvironment.space/api',
  bookingWindowDays: 7,
  maxUploadMb: 5,
};
