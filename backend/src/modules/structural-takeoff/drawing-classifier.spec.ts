import { classifyDrawingFilename } from './drawing-classifier';

describe('classifyDrawingFilename', () => {
  it('detects framing plan from Japanese filename', () => {
    const r = classifyDrawingFilename('S-2F伏図.pdf');
    expect(r.kind).toBe('framing_plan');
    expect(r.level).toBe('2F');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects column list', () => {
    const r = classifyDrawingFilename('柱リスト_v2.pdf');
    expect(r.kind).toBe('column_list');
  });

  it('detects beam list', () => {
    const r = classifyDrawingFilename('大梁リスト.pdf');
    expect(r.kind).toBe('beam_list');
  });

  it('detects roof / R floor', () => {
    const r = classifyDrawingFilename('RF伏図.dwg');
    expect(r.level).toBe('R');
    expect(r.kind).toBe('framing_plan');
  });

  it('detects basement floor', () => {
    const r = classifyDrawingFilename('B1F平面図.pdf');
    expect(r.level).toBe('B1');
  });

  it('detects PH (penthouse)', () => {
    const r = classifyDrawingFilename('PH-EVシャフト.pdf');
    expect(r.level).toBe('PH');
    expect(r.kind).toBe('elevator_shaft');
  });

  it('detects block from English Block A pattern', () => {
    const r = classifyDrawingFilename('BlockA-2F-framing-plan.dwg');
    expect(r.block).toBe('A');
    expect(r.kind).toBe('framing_plan');
    expect(r.level).toBe('2F');
  });

  it('detects 工区 from Japanese pattern', () => {
    const r = classifyDrawingFilename('A工区_3F伏図.pdf');
    expect(r.block).toBe('A');
    expect(r.level).toBe('3F');
  });

  it('detects stair detail', () => {
    const r = classifyDrawingFilename('階段詳細.pdf');
    expect(r.kind).toBe('stair_detail');
  });

  it('detects stair section-style filename', () => {
    const r = classifyDrawingFilename('S-2F-階段セクション詳細.pdf');
    expect(r.kind).toBe('stair_detail');
    expect(r.level).toBe('2F');
  });

  it('detects elevator machine-room / hoistway detail filename', () => {
    const r = classifyDrawingFilename('昇降機機械室詳細.pdf');
    expect(r.kind).toBe('elevator_shaft');
  });

  it('detects level diagram', () => {
    const r = classifyDrawingFilename('階高表.pdf');
    expect(r.kind).toBe('level_diagram');
  });

  it('returns unknown for unrelated filenames', () => {
    const r = classifyDrawingFilename('random_image_4521.png');
    expect(r.kind).toBe('unknown');
    expect(r.level).toBeNull();
    expect(r.block).toBeNull();
  });

  it('caps confidence at 1', () => {
    const r = classifyDrawingFilename('A工区_2F伏図.pdf');
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});
