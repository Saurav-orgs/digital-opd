import type { MutableRefObject } from 'react';

/**
 * A handle the prescription modes use to say "here is how you make the server
 * hold my current draft".
 *
 * The preview has always had to flush before it renders — the editor saves its
 * fields, the handwriting pad uploads its strokes — or the doctor is shown the
 * version from before the change they pressed the button to check. That used
 * to be private to each mode, because the preview was a dialog those modes
 * opened themselves.
 *
 * Now that Preview is a step of the consultation, the page opens it, and the
 * page has no idea which mode is active or what flushing it involves. Each
 * mode registers its own step here instead, and the preview calls whatever it
 * finds. Nothing registered — the upload mode has no draft to flush — is a
 * no-op, not an error.
 */
export type DraftFlushRef = MutableRefObject<(() => Promise<void>) | null>;

/** Run the registered flush, if any. Failures belong to the caller. */
export async function flushDraft(ref: DraftFlushRef | undefined): Promise<void> {
  await ref?.current?.();
}
