import { Test } from '@nestjs/testing';
import { ScaffoldCalculatorService } from './scaffold-calculator.service';

describe('ScaffoldCalculatorService — Nuno (610) corner dedup', () => {
  let service: ScaffoldCalculatorService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ScaffoldCalculatorService],
    }).compile();
    service = moduleRef.get(ScaffoldCalculatorService);
  });

  it('aggregated 610mm Nuno Bar drops after shared-corner width negarami / bearer dedup (closed rectangle)', () => {
    // Perimeter matches 4×(1829+1829+914+610) style long sides and 1829+610+610 short sides (mm order from span fit may vary).
    const walls = [
      { side: 'AB', wallLengthMm: 5182, wallHeightMm: 1800, stairAccessCount: 0 },
      { side: 'BC', wallLengthMm: 3049, wallHeightMm: 1800, stairAccessCount: 0 },
      { side: 'CD', wallLengthMm: 5182, wallHeightMm: 1800, stairAccessCount: 0 },
      { side: 'DA', wallLengthMm: 3049, wallHeightMm: 1800, stairAccessCount: 0 },
    ];
    const result = service.calculate({
      walls,
      scaffoldWidthMm: 610,
      preferredMainTatejiMm: 1800,
    });
    const n610 = result.summary.find((c) => c.type === 'nuno_bar' && c.sizeSpec === '610');
    expect(n610).toBeDefined();
    // Regression lock: closed rectangle should not double-count width-direction negarami / bearers at corners.
    // For 5+4+5+4 post lines and L=1, width negarami + bearer alone drop by 8 vs naive (shared corners).
    expect(n610!.quantity).toBe(52);
  });
});
