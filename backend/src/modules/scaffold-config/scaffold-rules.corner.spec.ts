import {
  CORNER_OVERRUN_MM,
  CORNER_SPAN_MM,
  CORNER_START_SPAN_MM,
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
  it('uses 1800 first, terminal = scaffold width; run includes +300mm plus one width-module when middle ≥ 600', () => {
    const wallMm = 10_200;
    const spans = fitSpansToWallLengthWithCorner(wallMm, 600);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(cornerTerminalSpanMmKusabi(600));
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(wallMm + CORNER_OVERRUN_MM + CORNER_SPAN_MM);
  });

  it('terminal span matches 900mm scaffold width (6000mm wall)', () => {
    const spans = fitSpansToWallLengthWithCorner(6000, 900);
    expect(spans[spans.length - 1]).toBe(900);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(6000 + CORNER_OVERRUN_MM + 900);
    expect(spans).toEqual([1800, 1800, 1800, 900, 900]);
  });

  it('6000mm wall @ 600 width: 1800×3 + 900 + 600 (6 posts per row inner/outer)', () => {
    const spans = fitSpansToWallLengthWithCorner(6000, 600);
    expect(spans).toEqual([1800, 1800, 1800, 900, 600]);
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

  it('exact two-span layout when wallLength = 2100mm (no middle)', () => {
    const spans = fitSpansToWallLengthWithCorner(2100, 600);
    expect(spans).toEqual([CORNER_START_SPAN_MM, CORNER_SPAN_MM]);
  });

  it('falls back to 600–600 pattern when wall is too short for 1800+600+overrun', () => {
    const spans = fitSpansToWallLengthWithCorner(1500, 600);
    expect(spans[0]).toBe(CORNER_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(1500 + CORNER_OVERRUN_MM);
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
});
