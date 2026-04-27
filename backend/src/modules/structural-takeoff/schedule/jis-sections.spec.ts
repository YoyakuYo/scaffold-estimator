import { resolveKgPerM, pieceWeightKg, ALL_SECTION_KEYS, getCatalogEntries } from './jis-sections';

describe('jis-sections', () => {
  it('resolves an exact catalog match', () => {
    expect(resolveKgPerM('H-600x200x11x17')).toBeCloseTo(106.0, 1);
    expect(resolveKgPerM('H-400x400x13x21')).toBeCloseTo(172.0, 1);
    expect(resolveKgPerM('RHS-300x300x12')).toBeCloseTo(105.0, 1);
    expect(resolveKgPerM('CHS-318.5x9')).toBeCloseTo(68.7, 1);
    expect(resolveKgPerM('L-100x100x10')).toBeCloseTo(14.9, 1);
  });

  it('is case-insensitive and ignores spaces / × variants', () => {
    expect(resolveKgPerM('h-600 x 200 x 11 x 17')).toBeCloseTo(106.0, 1);
    expect(resolveKgPerM('H-600×200×11×17')).toBeCloseTo(106.0, 1);
  });

  it('falls back to closest in-family match for unknown sections', () => {
    // Not in catalog; closest H- entry by depth is H-600x200, ~106 kg/m.
    const w = resolveKgPerM('H-595x200x12x18');
    expect(w).toBeGreaterThan(50);
    // Closest CHS to 320 mm is CHS-318.5x9 (~68.7 kg/m).
    const chs = resolveKgPerM('CHS-320x9');
    expect(chs).toBeGreaterThan(40);
    // Closest RHS to 290 mm is RHS-300x300x9 (~80 kg/m).
    const rhs = resolveKgPerM('RHS-290x290x9');
    expect(rhs).toBeGreaterThan(50);
  });

  it('handles each major family', () => {
    expect(resolveKgPerM('I-200x100x7x10')).toBeGreaterThan(0);
    expect(resolveKgPerM('C-200x80x7.5x11')).toBeGreaterThan(0);
    expect(resolveKgPerM('CT-250x250x9x14')).toBeGreaterThan(0);
  });

  it('returns 0 for clearly unparseable input', () => {
    expect(resolveKgPerM('')).toBe(0);
    expect(resolveKgPerM(null)).toBe(0);
    expect(resolveKgPerM(undefined)).toBe(0);
  });

  it('pieceWeightKg multiplies kg/m by piece length', () => {
    // H-600x200x11x17 ≈ 106 kg/m × 6 m default for oobari = 636 kg.
    expect(pieceWeightKg('H-600x200x11x17', 'oobari')).toBeGreaterThan(600);
    expect(pieceWeightKg('H-600x200x11x17', 'oobari')).toBeLessThan(700);
  });

  it('uses element-type default piece length when none provided', () => {
    // hashira default 4 m, kobari default 4 m.
    const hashira = pieceWeightKg('H-400x400x13x21', 'hashira');
    const kobari = pieceWeightKg('H-450x200x9x14', 'kobari');
    expect(hashira).toBeGreaterThan(0);
    expect(kobari).toBeGreaterThan(0);
  });

  it('catalog has comprehensive coverage', () => {
    expect(ALL_SECTION_KEYS.length).toBeGreaterThan(150);
  });

  it('exposes families for diagnostic UI', () => {
    const entries = getCatalogEntries();
    const families = new Set(entries.map((e) => e.family));
    expect(families.has('H')).toBe(true);
    expect(families.has('RHS')).toBe(true);
    expect(families.has('CHS')).toBe(true);
    expect(families.has('L')).toBe(true);
    expect(families.has('C')).toBe(true);
    expect(families.has('CT')).toBe(true);
    expect(families.has('I')).toBe(true);
  });
});
