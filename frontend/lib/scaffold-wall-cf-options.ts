/**
 * Per-wall CF dropdown (drawing upload panel) — R(reflex) or C only.
 * Stored on {@link WallState.cfNote} as the string key.
 */
export const SCAFFOLD_WALL_CF_KEYS = ['reflex', 'c'] as const;

export type ScaffoldWallCfKey = (typeof SCAFFOLD_WALL_CF_KEYS)[number];

export function isScaffoldWallCfKey(v: string): v is ScaffoldWallCfKey {
  return (SCAFFOLD_WALL_CF_KEYS as readonly string[]).includes(v);
}

/** Legacy / empty values map to R(reflex). */
export function normalizeScaffoldWallCfKey(v: string | undefined | null): ScaffoldWallCfKey {
  if (v != null && isScaffoldWallCfKey(v)) return v;
  return 'reflex';
}
