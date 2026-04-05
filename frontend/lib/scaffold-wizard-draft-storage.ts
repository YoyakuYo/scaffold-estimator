/**
 * Scaffold calculator wizard draft in sessionStorage (walls, polygon, AI preview, etc.).
 * Expires after max age so refresh / next-day visits do not show stale jobs.
 */

export const SCAFFOLD_WIZARD_DRAFT_KEY = 'scaffold-wizard-draft-v1';

/** Bump when draft shape changes; old versions are discarded on read. */
export const WIZARD_DRAFT_SAVE_VERSION = 3;

/** Drop restored draft if last save is older than this (ms). */
export const WIZARD_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function clearScaffoldWizardDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SCAFFOLD_WIZARD_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
