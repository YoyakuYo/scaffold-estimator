import {
  CORNER_OVERRUN_MM,
  CORNER_SPAN_MM,
  CORNER_START_SPAN_MM,
  SPAN_SIZES,
  classifyKusabiRectangleEdgeRoles,
  cornerTerminalSpanMmKusabi,
  exactSumWithStandardSpans,
  fitSpansToWallLengthWithCorner,
  inferReflexVerticesFromOutline,
  scaffoldFacadeBasisMmFromCorners,
} from './scaffold-rules';
import {
  WAKUGUMI_CORNER_OVERRUN_MM,
  WAKUGUMI_CORNER_SPAN_MM,
  WAKUGUMI_CORNER_START_SPAN_MM,
  cornerTerminalSpanMmWakugumi,
  fitSpansToWallLengthWithCornerWakugumi,
} from './scaffold-rules-wakugumi';

describe('inferReflexVerticesFromOutline', () => {
  it('6-vertex orthogonal L: exactly one reflex (inner/re-entrant corner)', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    const r = inferReflexVerticesFromOutline(outline);
    expect(r).not.toBeNull();
    expect(r!.filter(Boolean).length).toBe(1);
    expect(r![3]).toBe(true);
  });

  it('rectangle: no reflex vertices', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const r = inferReflexVerticesFromOutline(outline);
    expect(r).not.toBeNull();
    expect(r!.every((v) => !v)).toBe(true);
  });
});

describe('scaffoldFacadeBasisMmFromCorners', () => {
  it('subtracts 300mm per reflex end (6000 + reflex at end → 5700)', () => {
    expect(scaffoldFacadeBasisMmFromCorners(6000, 'convex', 'reflex')).toBe(5700);
  });
  it('subtracts 600mm when both ends reflex', () => {
    expect(scaffoldFacadeBasisMmFromCorners(6000, 'reflex', 'reflex')).toBe(5400);
  });
  it('unchanged when both convex', () => {
    expect(scaffoldFacadeBasisMmFromCorners(6000, 'convex', 'convex')).toBe(6000);
  });
});

describe('fitSpansToWallLengthWithCorner (kusabi)', () => {
  it('rectangle short-edge hint: keeps corner-start, terminal, and at least nominal run length', () => {
    const wallMm = 10_800;
    const terminal = CORNER_SPAN_MM;
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600, { rectangleEdgeRole: 'short' });
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(terminal);
    const sum = spans.reduce((a, b) => a + b, 0);
    const target = wallMm + CORNER_OVERRUN_MM + terminal;
    expect(sum).toBeGreaterThanOrEqual(target);
    expect(sum).toBeLessThanOrEqual(target + CORNER_START_SPAN_MM);
  });

  it('rectangle long-edge hint: prefers all–corner-start middle when arithmetically possible', () => {
    // 10674 + 300 + 610 − 1829 − 610 = 9145 = 5 × 1829
    const spans = fitSpansToWallLengthWithCorner(10_674, 600, { rectangleEdgeRole: 'long' });
    const mid = spans.slice(1, -1);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.every((s) => s === CORNER_START_SPAN_MM)).toBe(true);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(10_674 + CORNER_OVERRUN_MM + CORNER_SPAN_MM);
  });

  it('classifyKusabiRectangleEdgeRoles: shorter length → short, longer → long (no template gate)', () => {
    const lens = [10_800, 12_300, 10_800, 12_300];
    expect(classifyKusabiRectangleEdgeRoles(lens, 600)).toEqual(['short', 'long', 'short', 'long']);
  });

  it('uses corner-start first; generic wall achieves at least nominal run (10200mm)', () => {
    const wallMm = 10_200;
    const terminal = cornerTerminalSpanMmKusabi(600);
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(terminal);
    const sum = spans.reduce((a, b) => a + b, 0);
    const target = wallMm + CORNER_OVERRUN_MM + terminal;
    expect(sum).toBeGreaterThanOrEqual(target);
    expect(sum).toBeLessThanOrEqual(target + CORNER_START_SPAN_MM);
  });

  it('terminal span 914mm width: 6000mm wall generic fit', () => {
    const wallMm = 6000;
    const terminal = cornerTerminalSpanMmKusabi(900);
    const spans = fitSpansToWallLengthWithCorner(wallMm, 900);
    expect(spans[spans.length - 1]).toBe(terminal);
    const sum = spans.reduce((a, b) => a + b, 0);
    const target = wallMm + CORNER_OVERRUN_MM + terminal;
    expect(sum).toBeGreaterThanOrEqual(target);
    expect(sum).toBeLessThanOrEqual(target + CORNER_START_SPAN_MM);
  });

  it('6000mm wall @ 600 width (no rectangle hint): valid middle packing', () => {
    const wallMm = 6000;
    const terminal = cornerTerminalSpanMmKusabi(600);
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    const target = wallMm + CORNER_OVERRUN_MM + terminal;
    expect(sum).toBeGreaterThanOrEqual(target);
    expect(sum).toBeLessThanOrEqual(target + CORNER_START_SPAN_MM);
  });

  it('allows bounded overrun when middle is not an exact sum of standard spans', () => {
    const wallMm = 10_000;
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    const expectedBase = wallMm + CORNER_OVERRUN_MM + CORNER_SPAN_MM;
    expect(sum).toBeGreaterThanOrEqual(expectedBase);
    expect(sum).toBeLessThanOrEqual(expectedBase + 1829);
  });

  it('short wall (legacy): three width-modules when wall+300 < 1829+610', () => {
    // 1530 + 300 = 1830 = 610 + 610 + 610
    const spans = fitSpansToWallLengthWithCorner(1530, 600);
    expect(spans).toEqual([CORNER_SPAN_MM, CORNER_SPAN_MM, CORNER_SPAN_MM]);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(1530 + CORNER_OVERRUN_MM);
  });

  it('falls back to terminal–middle–terminal when wall+300 < corner-start+terminal', () => {
    const spans = fitSpansToWallLengthWithCorner(1834, 600);
    expect(spans[0]).toBe(CORNER_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(1834 + CORNER_OVERRUN_MM);
    expect(spans).toEqual([CORNER_SPAN_MM, 914, CORNER_SPAN_MM]);
  });

  it('reflex end (Rule 1): last span = width-module; total run = wall − 300 (walk joint)', () => {
    // effective 5487 − 1829 − 610 = 3048 = 1829 + 1219 (exact middle before terminal bay)
    const wallMm = 5787;
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600, {
      startCornerKind: 'convex',
      endCornerKind: 'reflex',
    });
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(wallMm - CORNER_OVERRUN_MM);
  });

  it('reflex end (Rule 2): when exact terminal-last packing is impossible, uses inner-line pack', () => {
    const wallMm = 5555;
    const terminal = cornerTerminalSpanMmKusabi(600);
    const eff = wallMm - CORNER_OVERRUN_MM;
    const need = eff - CORNER_START_SPAN_MM - terminal;
    expect(exactSumWithStandardSpans(need, SPAN_SIZES)).toBeNull();
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600, {
      startCornerKind: 'convex',
      endCornerKind: 'reflex',
    });
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(eff);
  });

  it('exactSumWithStandardSpans: decomposes when possible', () => {
    expect(exactSumWithStandardSpans(3658, SPAN_SIZES)?.reduce((a, b) => a + b, 0)).toBe(3658);
    expect(exactSumWithStandardSpans(2855, SPAN_SIZES)).toBeNull();
  });
});

describe('fitSpansToWallLengthWithCornerWakugumi', () => {
  it('uses 1829 first, 610 last @ 600 width; total run >= wall+300', () => {
    const wallMm = 10_000;
    const spans = fitSpansToWallLengthWithCornerWakugumi(wallMm, 600);
    expect(spans[0]).toBe(WAKUGUMI_CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(cornerTerminalSpanMmWakugumi(600));
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(wallMm + WAKUGUMI_CORNER_OVERRUN_MM);
    expect(sum).toBeLessThanOrEqual(wallMm + WAKUGUMI_CORNER_OVERRUN_MM + 2000);
  });

  it('exact two-span when wallLength fits 1829+610+300', () => {
    const wallMm =
      WAKUGUMI_CORNER_START_SPAN_MM +
      WAKUGUMI_CORNER_SPAN_MM -
      WAKUGUMI_CORNER_OVERRUN_MM;
    const spans = fitSpansToWallLengthWithCornerWakugumi(wallMm, 600);
    expect(spans).toEqual([
      WAKUGUMI_CORNER_START_SPAN_MM,
      WAKUGUMI_CORNER_SPAN_MM,
    ]);
  });

  it('terminal span 914mm when scaffold width 900mm', () => {
    const spans = fitSpansToWallLengthWithCornerWakugumi(8000, 900);
    expect(spans[spans.length - 1]).toBe(914);
  });

  it('reflex end: last span = width-module when exact packing exists', () => {
    // 6397 − 300 = 6097 = 1829 + 1829 + 610 + 1829 (corner start + 2 middles + terminal)
    const wallMm = 6397;
    const terminal = cornerTerminalSpanMmWakugumi(600);
    const spans = fitSpansToWallLengthWithCornerWakugumi(wallMm, 600, {
      startCornerKind: 'convex',
      endCornerKind: 'reflex',
    });
    expect(spans[0]).toBe(WAKUGUMI_CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(terminal);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(wallMm - WAKUGUMI_CORNER_OVERRUN_MM);
  });
});
