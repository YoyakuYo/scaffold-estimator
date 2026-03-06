/**
 * Japanese BIM compliance (Shime-shiki / 締め式 足場).
 * Applied automatically in AI BIM Mode only.
 * MHLW safety standards; all dimensions in millimeters (mm).
 */

export const AI_BIM_RULES = {
  /** Vertical standards spacing (支柱間隔) */
  VERTICAL_STANDARD_SPACING_MM: 1800,
  /** Ledger spacing — primary (大桟間隔) */
  LEDGER_SPACING_PRIMARY_MM: 1800,
  /** Ledger spacing — secondary (中桟間隔) */
  LEDGER_SPACING_SECONDARY_MM: 1200,
  /** Handrail height minimum (手摺高さ) MHLW */
  HANDRAIL_HEIGHT_MIN_MM: 850,
  /** Middle rail 中桟 height above platform */
  MIDDLE_RAIL_HEIGHT_MM: 450,
  /** Level height (1 level) */
  LEVEL_HEIGHT_MM: 1800,
} as const;

export function getAiBimDefaults() {
  return {
    preferredMainTatejiMm: AI_BIM_RULES.VERTICAL_STANDARD_SPACING_MM,
    topGuardHeightMm: AI_BIM_RULES.HANDRAIL_HEIGHT_MIN_MM,
    scaffoldWidthMm: 900 as 600 | 900 | 1200,
    levelHeightMm: AI_BIM_RULES.LEVEL_HEIGHT_MM,
    handrailHeightMm: AI_BIM_RULES.HANDRAIL_HEIGHT_MIN_MM,
    middleRailHeightMm: AI_BIM_RULES.MIDDLE_RAIL_HEIGHT_MM,
  };
}
