/**
 * UI helpers: store signed mm along the chosen axis internally; show 図面-style positive length + direction.
 */

export type EdgePlanRunSign = 1 | -1;

export function edgePlanRunMagnitudeMm(signedMm: number): number {
  return Math.abs(Math.round(signedMm));
}

export function edgePlanRunSign(signedMm: number): EdgePlanRunSign {
  return signedMm >= 0 ? 1 : -1;
}

export function composeEdgePlanAxisMm(magnitudeMm: number, sign: EdgePlanRunSign): number {
  const m = Math.abs(Math.round(magnitudeMm));
  return sign * m;
}

/** Label for direction along the selected axis (Unicode minus U+2212). */
export function edgePlanRunDirectionLabel(axis: 'X' | 'Y', sign: EdgePlanRunSign): string {
  const sym = sign === 1 ? '+' : '\u2212';
  return `${sym}${axis}`;
}

export function parsePositiveMetersToMm(raw: string): number | null {
  const v = parseFloat(String(raw).trim());
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 1000);
}
