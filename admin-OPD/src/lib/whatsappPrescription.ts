import { consultationApi } from '../api/endpoints';

/**
 * Open the patient's WhatsApp chat with a link to the visit's prescription.
 *
 * WhatsApp opens a chat with any number — saved contact or not — but only
 * with text, so the prescription goes as a link. The server issues a draft
 * if needed, mints the link and builds the wa.me URL; the only job here is
 * to open it. The tab is opened synchronously on the tap and pointed at the
 * URL once the reply lands, because a window opened after an `await` is what
 * phone browsers block as a popup. Rejects with the API's error on failure.
 */
export async function openPrescriptionOnWhatsApp(appointmentId: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const { whatsapp_url } = await consultationApi.prescriptionWhatsAppLink(appointmentId);
    if (tab) tab.location.href = whatsapp_url;
    else window.location.href = whatsapp_url;
  } catch (err) {
    tab?.close();
    throw err;
  }
}
