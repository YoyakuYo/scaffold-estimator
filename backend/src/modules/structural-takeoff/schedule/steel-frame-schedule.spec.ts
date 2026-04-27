import type { ExtractedElement } from '../extracted-element.entity';
import { aggregateSteelFrameLines, totalsFromSteelLines } from './steel-frame-schedule';

function row(p: Partial<ExtractedElement> & Pick<ExtractedElement, 'qty'>): ExtractedElement {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    setId: 'set',
    level: '2F',
    block: 'A',
    elementType: 'oobari',
    label: 'G1',
    section: 'H-600x200x11x17',
    grid: null,
    source: 'manual',
    notes: null,
    pieceLengthMm: null,
    phase: null,
    shop: null,
    lineKind: 'member',
    extractionConfidence: null,
    needsReview: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...p,
  } as ExtractedElement;
}

describe('aggregateSteelFrameLines', () => {
  it('merges identical section across floors into one line', () => {
    const lines = aggregateSteelFrameLines([
      row({ level: '1F', qty: 4, pieceLengthMm: 6000 }),
      row({ level: '2F', qty: 4, pieceLengthMm: 6000 }),
    ]);
    expect(lines.length).toBe(1);
    expect(lines[0].lengthM).toBeCloseTo(48, 0); // 8 * 6m
    expect(lines[0].shapeNameJp).toBe('Ｈ形鋼');
    const t = totalsFromSteelLines(lines);
    expect(t.designKg).toBeGreaterThan(1000);
  });

  it('uses default length when pieceLengthMm is null', () => {
    const lines = aggregateSteelFrameLines([
      row({ elementType: 'hashira', qty: 2, section: 'H-400x400x13x21', pieceLengthMm: null }),
    ]);
    expect(lines.length).toBe(1);
    expect(lines[0].lengthM).toBeGreaterThan(0);
  });

  it('skips non-member line kinds (e.g. bolts) in steel mass rollups', () => {
    const lines = aggregateSteelFrameLines([
      row({ qty: 2, pieceLengthMm: 6000, lineKind: 'member' }),
      row({
        qty: 100,
        elementType: 'brace',
        section: 'HTB-M20',
        lineKind: 'bolt',
        pieceLengthMm: 65,
      }),
    ]);
    expect(lines.length).toBe(1);
    expect(lines[0].lengthM).toBeCloseTo(12, 1);
  });
});
