/** Internal storage and APIs remain millimeters; UI inputs use meters. */
export const MM_PER_M = 1000;

export function mmToM(mm: number): number {
  return mm / MM_PER_M;
}

export function mToMm(meters: number): number {
  return Math.round(meters * MM_PER_M);
}

/** Trim trailing zeros for display, e.g. 600mm → "0.6 m". */
export function formatMmAsMetersLabel(mm: number): string {
  const m = mmToM(mm);
  const decimals = Math.abs(m) >= 10 ? 2 : 3;
  const s = m.toFixed(decimals).replace(/\.?0+$/, '');
  return `${s || '0'} m`;
}

/** Scaffold catalog / material sizes stored as mm (e.g. width, frame height, post length). */
export function formatMmLabel(mm: number): string {
  if (!Number.isFinite(mm)) return '—';
  return `${Math.round(mm)} mm`;
}
