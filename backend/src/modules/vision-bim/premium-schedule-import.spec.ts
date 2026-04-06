import { parsePremiumScheduleBuffer, parseSpanConfigurationText } from './premium-schedule-import';

describe('premium-schedule-import', () => {
  it('parses span configuration lines', () => {
    const text = `Span Configuration
AB / X1–X8 (7 spans 1.829m×1 1.219m×1 0.914m×5)
BC / X1–X6 (5 spans 1.829m×1 1.524m×1 0.914m×3)
CD / X1–X6 (5 spans 1.829m×1 1.524m×1 0.914m×3)
DE / X1–X2 (1 spans 1.829m×1)
EF / X1–X4 (3 spans 0.914m×1 0.61m×2)
FA / X1–X4 (3 spans 1.829m×1 1.524m×1 0.914m×1)`;
    const r = parseSpanConfigurationText(text);
    expect(r.edgeLabels).toEqual(['AB', 'BC', 'CD', 'DE', 'EF', 'FA']);
    expect(r.wallLengthsMm[0]).toBe(1829 + 1219 + 5 * 914);
    expect(r.wallLengthsMm[4]).toBe(914 + 2 * 610);
    expect(r.baysMmByEdge.AB?.length).toBe(7);
  });

  it('parses JSON manifest', () => {
    const j = JSON.stringify({
      version: 1,
      wallLengthsMm: [10000, 20000, 10000, 20000],
    });
    const r = parsePremiumScheduleBuffer(Buffer.from(j, 'utf-8'), 'x.json');
    expect(r.wallLengthsMm).toEqual([10000, 20000, 10000, 20000]);
    expect(r.source).toBe('json');
  });

  it('parses CSV', () => {
    const csv = `edge,length_m
AB,7.618
BC,6.095
CD,6.095`;
    const r = parsePremiumScheduleBuffer(Buffer.from(csv, 'utf-8'), 'x.csv');
    expect(r.edgeLabels).toEqual(['AB', 'BC', 'CD']);
    expect(r.wallLengthsMm[0]).toBe(7618);
  });
});
