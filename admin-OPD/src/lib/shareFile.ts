/**
 * Handing a real file to the platform's share sheet.
 *
 * Web Share with `files` is the path that matters: on a phone the doctor taps
 * Share, picks WhatsApp, and the actual PDF goes to the patient — no link, no
 * expiry, nothing to configure. Most desktop browsers do not implement it, so
 * rather than dead-ending with "not supported" the file is saved instead,
 * which is what the doctor would then attach by hand.
 *
 * Note the files never come from S3 directly. That bucket sends no
 * `Access-Control-Allow-Origin`, so `fetch`ing an object URL from the browser
 * is blocked before a single byte arrives — which is what broke Share QR. The
 * bytes come through the API instead, which sets CORS for this app.
 */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** Saves a file to disk. Used as the fallback where sharing is unavailable. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari needs the URL alive while the click is handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Offers `file` to the share sheet, falling back to a download.
 *
 * Returns what actually happened so the caller can say something true — a
 * doctor who dismissed the sheet has not failed at anything and should not be
 * shown an error.
 */
export async function shareFile(
  file: File,
  meta: { title: string; text?: string },
): Promise<ShareOutcome> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: meta.title, text: meta.text });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }

  downloadFile(file);
  return 'downloaded';
}

/**
 * The server's filename for a download, read from Content-Disposition.
 *
 * The header is exposed to this origin explicitly by the API; if a proxy
 * strips it, the caller's own fallback name is used.
 */
export function filenameFromDisposition(
  disposition: unknown,
  fallback: string,
): string {
  if (typeof disposition !== 'string') return fallback;
  const match =
    /filename\*=UTF-8''([^;]+)/i.exec(disposition) ??
    /filename="?([^";]+)"?/i.exec(disposition);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}
