/**
 * Per-wall CF (corner / condition) dropdown values for drawing upload panel.
 * Stored on {@link WallState.cfNote} as the string key (empty = not specified).
 */
export const SCAFFOLD_WALL_CF_KEYS = ['', 'std', 'pattanko', 'opening', 'stair', 'other'] as const;

export type ScaffoldWallCfKey = (typeof SCAFFOLD_WALL_CF_KEYS)[number];

export function isScaffoldWallCfKey(v: string): v is ScaffoldWallCfKey {
  return (SCAFFOLD_WALL_CF_KEYS as readonly string[]).includes(v);
}

export function normalizeScaffoldWallCfKey(v: string | undefined | null): ScaffoldWallCfKey {
  if (v == null || v === '') return '';
  return isScaffoldWallCfKey(v) ? v : '';
}
