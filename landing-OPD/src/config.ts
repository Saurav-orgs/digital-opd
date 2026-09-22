/**
 * Everything that is "ours" and likely to change lives here — where the
 * product apps are deployed, contact details, API base. Nothing else in the
 * landing hard-codes a URL, so this is the only file to edit when it changes.
 */
export const AppConfig = {
  // Must include the scheme: a scheme-less baseURL resolves relative to the
  // current origin, which breaks the deployed app.
  apiBaseUrl: 'https://76ml0vk8-3000.inc1.devtunnels.ms/api',

  /** GST added on top of every plan. The server computes the real amount; this is for display. */
  gstRatePercent: 18,

  links: {
    /** admin-OPD — where a doctor lands after paying. */
    doctorLogin: 'https://app.mydigitalopd.com/login',
    /** patient-web-OPD — the booking side. */
    patientPortal: 'https://book.mydigitalopd.com',
  },

  /** WhatsApp number, international format, digits only. Placeholder. */
  whatsapp: '919999999999',
};

export function whatsappUrl(message: string): string {
  return `https://wa.me/${AppConfig.whatsapp}?text=${encodeURIComponent(message)}`;
}
