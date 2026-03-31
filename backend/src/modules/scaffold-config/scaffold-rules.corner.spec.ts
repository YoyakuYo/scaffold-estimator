import {
  CORNER_OVERRUN_MM,
  CORNER_SPAN_MM,
  CORNER_START_SPAN_MM,
  classifyKusabiRectangleEdgeRoles,
  cornerTerminalSpanMmKusabi,
  fitSpansToWallLengthWithCorner,
} from './scaffold-rules';
import {
  WAKUGUMI_CORNER_OVERRUN_MM,
  WAKUGUMI_CORNER_SPAN_MM,
  WAKUGUMI_CORNER_START_SPAN_MM,
  cornerTerminalSpanMmWakugumi,
  fitSpansToWallLengthWithCornerWakugumi,
} from './scaffold-rules-wakugumi';

describe('fitSpansToWallLengthWithCorner (kusabi)', () => {
  it('rectangle short-edge hint: prefers 1200 then (terminal+300) before last terminal', () => {
    const spans = fitSpansToWallLengthWithCorner(10_800, 600, { rectangleEdgeRole: 'short' });
    const mid = spans.slice(1, -1);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    expect(mid.length).toBeGreaterThanOrEqual(2);
    expect(mid[mid.length - 2]).toBe(1200);
    expect(mid[mid.length - 1]).toBe(CORNER_SPAN_MM + CORNER_OVERRUN_MM);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(10_800 + CORNER_OVERRUN_MM + CORNER_SPAN_MM);
  });

  it('rectangle long-edge hint: prefers all-1800 middle when arithmetically possible', () => {
    const spans = fitSpansToWallLengthWithCorner(12_300, 600, { rectangleEdgeRole: 'long' });
    const mid = spans.slice(1, -1);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.every((s) => s === CORNER_START_SPAN_MM)).toBe(true);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(12_300 + CORNER_OVERRUN_MM + CORNER_SPAN_MM);
  });

  it('classifyKusabiRectangleEdgeRoles: shorter length → short, longer → long (no template gate)', () => {
    const lens = [10_800, 12_300, 10_800, 12_300];
    expect(classifyKusabiRectangleEdgeRoles(lens, 600)).toEqual(['short', 'long', 'short', 'long']);
  });

  it('uses 1800 first; generic wall sum = wall + 300 + terminal (10200mm)', () => {
    const wallMm = 10_200;
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(cornerTerminalSpanMmKusabi(600));
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(wallMm + CORNER_OVERRUN_MM + CORNER_SPAN_MM);
  });

  it('terminal span 900mm width: 6000mm wall generic fit', () => {
    const spans = fitSpansToWallLengthWithCorner(6000, 900);
    expect(spans[spans.length - 1]).toBe(900);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(6000 + CORNER_OVERRUN_MM + 900);
    expect(spans).toEqual([1800, 1800, 1800, 900, 900]);
  });

  it('6000mm wall @ 600 width (no rectangle hint): valid middle packing', () => {
    const spans = fitSpansToWallLengthWithCorner(6000, 600);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(6000 + CORNER_OVERRUN_MM + CORNER_SPAN_MM);
  });

  it('allows bounded overrun when middle is not an exact sum of standard spans', () => {
    const wallMm = 10_000;
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    const expectedBase = wallMm + CORNER_OVERRUN_MM + CORNER_SPAN_MM;
    expect(sum).toBeGreaterThanOrEqual(expectedBase);
    expect(sum).toBeLessThanOrEqual(expectedBase + 600);
  });

  it('2100mm: middle 600mm → 1800 + 600 + 600 (run includes +300 and terminal)', () => {
    const spans = fitSpansToWallLengthWithCorner(2100, 600);
    expect(spans).toEqual([CORNER_START_SPAN_MM, 600, CORNER_SPAN_MM]);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(2100 + CORNER_OVERRUN_MM + CORNER_SPAN_MM);
  });

  it('falls back to 600–600–600 when wall+300 < 1800+600 (1500mm)', () => {
    const spans = fitSpansToWallLengthWithCorner(1500, 600);
    expect(spans[0]).toBe(CORNER_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(1500 + CORNER_OVERRUN_MM);
  });

  it('reflex end: uses -300 inset and no forced terminal bay', () => {
    const wallMm = 6000;
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600, {
      startCornerKind: 'convex',
      endCornerKind: 'reflex',
    });
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    // Must NOT exceed the closed inner corner line: max run = wall - 300mm
    expect(sum).toBeLessThanOrEqual(wallMm - CORNER_OVERRUN_MM);
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

  it('reflex end: uses -300 inset and no forced terminal bay', () => {
    const wallMm = 8000;
    const spans = fitSpansToWallLengthWithCornerWakugumi(wallMm, 600, {
      startCornerKind: 'convex',
      endCornerKind: 'reflex',
    });
    expect(spans[0]).toBe(WAKUGUMI_CORNER_START_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(wallMm - WAKUGUMI_CORNER_OVERRUN_MM);
  });
});
