/** Catalog 足場幅 (mm) — front↔back between post rows; 610 / 914 / 1219 (2尺 / 3尺 / 4尺 class). */

export const SCAFFOLD_WIDTH_NARROW_MM = 610;
export const SCAFFOLD_WIDTH_MEDIUM_MM = 914;
export const SCAFFOLD_WIDTH_WIDE_MM = 1219;

export const SCAFFOLD_WIDTH_CATALOG_MM = [610, 914, 1219] as const;
export type ScaffoldWidthCatalogMm = (typeof SCAFFOLD_WIDTH_CATALOG_MM)[number];

/** Map legacy nominal widths (600/900/1200) and stray values to the catalog triple. */
export function normalizeScaffoldWidthMmToCatalog(widthMm: number): ScaffoldWidthCatalogMm {
  const w = Number(widthMm);
  if (!Number.isFinite(w) || w <= 0) return SCAFFOLD_WIDTH_NARROW_MM;
  if (w === 600 || w === SCAFFOLD_WIDTH_NARROW_MM) return SCAFFOLD_WIDTH_NARROW_MM;
  if (w === 900 || w === SCAFFOLD_WIDTH_MEDIUM_MM) return SCAFFOLD_WIDTH_MEDIUM_MM;
  if (w === 1200 || w === SCAFFOLD_WIDTH_WIDE_MM) return SCAFFOLD_WIDTH_WIDE_MM;
  if (w < 762) return SCAFFOLD_WIDTH_NARROW_MM;
  if (w < 1066) return SCAFFOLD_WIDTH_MEDIUM_MM;
  return SCAFFOLD_WIDTH_WIDE_MM;
}
