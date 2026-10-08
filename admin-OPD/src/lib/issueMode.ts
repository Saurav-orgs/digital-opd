import type { MutableRefObject } from 'react';
import type { IssueMode } from '../api/types';

/**
 * A handle the page reads at the moment Preview or Issue is pressed, to learn
 * which tab the doctor is writing in.
 *
 * The same shape as `DraftFlushRef`, and for the same reason: the buttons live
 * on the page and the tabs live inside the prescription card, and the page has
 * no business re-rendering every time a doctor looks at another tab. A ref is
 * read when it is needed and costs nothing in between.
 *
 * It matters because a visit can hold three drafts at once — typed, e-pen,
 * photographed — and only the tab the doctor pressed the button on is the
 * prescription. Null means nothing registered; the server then infers it from
 * the draft, as it did before any of this.
 */
export type IssueModeRef = MutableRefObject<IssueMode | null>;

/**
 * How each document is named in a sentence to the doctor.
 *
 * The content rather than the tab, because `structured` is written on two of
 * them — a dictated prescription and a typed one are the same document — and
 * "the Type tab" would be wrong half the time.
 */
export const ISSUE_MODE_LABEL: Record<IssueMode, string> = {
  structured: 'a typed prescription',
  handwritten: 'a handwritten page',
  uploaded: 'an uploaded scan',
};
