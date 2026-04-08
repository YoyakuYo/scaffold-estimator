import { Test } from '@nestjs/testing';
import { ScaffoldCalculatorWakugumiService } from './scaffold-calculator-wakugumi.service';
import { calculateLevelsWakugumi, cornerTerminalSpanMmWakugumi } from './scaffold-rules-wakugumi';
import { omitKusabiTesuriOnLastSpan } from './scaffold-rules';

describe('ScaffoldCalculatorWakugumiService — terminal bay inner face', () => {
  let service: ScaffoldCalculatorWakugumiService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ScaffoldCalculatorWakugumiService],
    }).compile();
    service = moduleRef.get(ScaffoldCalculatorWakugumiService);
  });

  it('deducts one inner brace and one inner shitasan per level band on last terminal span (multi-wall)', () => {
    const scaffoldWidthMm = 610;
    const walls = [
      { side: 'AB', wallLengthMm: 5182, wallHeightMm: 3600, stairAccessCount: 0 },
      { side: 'BC', wallLengthMm: 4000, wallHeightMm: 3600, stairAccessCount: 0 },
    ];
    const result = service.calculate({
      walls,
      scaffoldWidthMm,
      frameSizeMm: 1700,
      habakiCountPerSpan: 2,
    });
    const w0 = result.walls[0]!;
    const { spans } = w0;
    expect(spans.length).toBeGreaterThan(0);
    const terminal = cornerTerminalSpanMmWakugumi(scaffoldWidthMm);
    expect(spans[spans.length - 1]).toBe(terminal);

    const levelCalc = calculateLevelsWakugumi(w0.wallHeightMm, 1700);
    const L = levelCalc.fullLevels;
    const Ltot = L + 1;
    const skip = omitKusabiTesuriOnLastSpan(spans, scaffoldWidthMm, true);
    expect(skip).toBe(true);

    let braceSum = 0;
    let shitaSum = 0;
    for (const c of w0.components) {
      if (c.type === 'brace') braceSum += c.quantity;
      if (c.type === 'shitasan') shitaSum += c.quantity;
    }
    const expectedBrace = spans.length * 2 * Ltot - Ltot;
    const expectedShita = spans.length * 2 * Ltot - Ltot;
    expect(braceSum).toBe(expectedBrace);
    expect(shitaSum).toBe(expectedShita);
  });

  it('single wall: no inner-face deduction (no multi-wall corner layout)', () => {
    const scaffoldWidthMm = 610;
    const result = service.calculate({
      walls: [{ side: 'AB', wallLengthMm: 5182, wallHeightMm: 3600, stairAccessCount: 0 }],
      scaffoldWidthMm,
      frameSizeMm: 1700,
      habakiCountPerSpan: 2,
    });
    const w0 = result.walls[0]!;
    const { spans } = w0;
    const levelCalc = calculateLevelsWakugumi(w0.wallHeightMm, 1700);
    const Ltot = levelCalc.fullLevels + 1;
    expect(omitKusabiTesuriOnLastSpan(spans, scaffoldWidthMm, false)).toBe(false);

    let braceSum = 0;
    for (const c of w0.components) {
      if (c.type === 'brace') braceSum += c.quantity;
    }
    expect(braceSum).toBe(spans.length * 2 * Ltot);
  });
});
