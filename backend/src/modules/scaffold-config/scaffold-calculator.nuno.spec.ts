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
    // Shared-corner width negarami/bearer dedup + no inner 手摺 on terminal (足場幅) bay per wall.
    expect(n610!.quantity).toBe(36);
  });

  it('single wall: terminal-bay tesuri rule does not apply (no multi-wall corner layout)', () => {
    const result = service.calculate({
      walls: [{ side: 'AB', wallLengthMm: 5182, wallHeightMm: 1800, stairAccessCount: 0 }],
      scaffoldWidthMm: 610,
      preferredMainTatejiMm: 1800,
    });
    const w = result.walls[0]!;
    expect(w.spans.length).toBeGreaterThan(0);
    const n610 = result.summary.find((c) => c.type === 'nuno_bar' && c.sizeSpec === '610');
    expect(n610).toBeDefined();
    expect(n610!.quantity).toBeGreaterThan(0);
  });
});
