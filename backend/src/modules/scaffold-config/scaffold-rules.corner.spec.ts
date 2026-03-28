import {
  CORNER_OVERRUN_MM,
  CORNER_SPAN_MM,
  CORNER_START_SPAN_MM,
  fitSpansToWallLengthWithCorner,
} from './scaffold-rules';
import {
  WAKUGUMI_CORNER_OVERRUN_MM,
  WAKUGUMI_CORNER_SPAN_MM,
  WAKUGUMI_CORNER_START_SPAN_MM,
  fitSpansToWallLengthWithCornerWakugumi,
} from './scaffold-rules-wakugumi';

describe('fitSpansToWallLengthWithCorner (kusabi)', () => {
  it('uses 1800 first, 600 last; +300mm is total run only (last posts past corner)', () => {
    const wallMm = 10_200;
    const spans = fitSpansToWallLengthWithCorner(wallMm);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(wallMm + CORNER_OVERRUN_MM);
  });

  it('allows small overrun when wall length is not representable as exact middle span sum', () => {
    const wallMm = 10_000;
    const spans = fitSpansToWallLengthWithCorner(wallMm);
    expect(spans[0]).toBe(CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(wallMm + CORNER_OVERRUN_MM);
    expect(sum).toBeLessThanOrEqual(wallMm + CORNER_OVERRUN_MM + 600);
  });

  it('exact two-span layout when wallLength = 2100mm (no middle)', () => {
    const spans = fitSpansToWallLengthWithCorner(2100);
    expect(spans).toEqual([CORNER_START_SPAN_MM, CORNER_SPAN_MM]);
  });

  it('falls back to 600–600 pattern when wall is too short for 1800+600+overrun', () => {
    const spans = fitSpansToWallLengthWithCorner(1500);
    expect(spans[0]).toBe(CORNER_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBe(1500 + CORNER_OVERRUN_MM);
  });
});

describe('fitSpansToWallLengthWithCornerWakugumi', () => {
  it('uses 1829 first, 610 last; total run >= wall+300', () => {
    const wallMm = 10_000;
    const spans = fitSpansToWallLengthWithCornerWakugumi(wallMm);
    expect(spans[0]).toBe(WAKUGUMI_CORNER_START_SPAN_MM);
    expect(spans[spans.length - 1]).toBe(WAKUGUMI_CORNER_SPAN_MM);
    const sum = spans.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(wallMm + WAKUGUMI_CORNER_OVERRUN_MM);
    expect(sum).toBeLessThanOrEqual(wallMm + WAKUGUMI_CORNER_OVERRUN_MM + 2000);
  });

  it('exact two-span when wallLength fits 1829+610+300', () => {
    const wallMm =
      WAKUGUMI_CORNER_START_SPAN_MM +
      WAKUGUMI_CORNER_SPAN_MM -
      WAKUGUMI_CORNER_OVERRUN_MM;
    const spans = fitSpansToWallLengthWithCornerWakugumi(wallMm);
    expect(spans).toEqual([
      WAKUGUMI_CORNER_START_SPAN_MM,
      WAKUGUMI_CORNER_SPAN_MM,
    ]);
  });
});
