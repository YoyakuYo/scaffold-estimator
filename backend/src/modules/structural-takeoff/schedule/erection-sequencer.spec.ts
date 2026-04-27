import { runSequencer } from './erection-sequencer';
import type { ExtractedElement } from '../extracted-element.entity';

function el(
  level: string,
  block: string | null,
  elementType: ExtractedElement['elementType'],
  qty: number,
  section: string | null = null,
): ExtractedElement {
  return {
    id: `${block ?? '-'}-${level}-${elementType}`,
    setId: 'set',
    level,
    block,
    elementType,
    label: null,
    section,
    qty,
    grid: null,
    source: 'manual',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ExtractedElement;
}

describe('runSequencer', () => {
  it('produces activities only for element types with non-zero qty', () => {
    const result = runSequencer({
      levels: ['1F', '2F'],
      blocks: ['A'],
      elements: [
        el('1F', 'A', 'hashira', 12),
        el('2F', 'A', 'oobari', 8),
      ],
      calendar: { startDateIso: '2026-05-07', workSaturday: false },
    });
    const types = result.activities.map((a) => a.elementType);
    expect(types).toContain('hashira');
    expect(types).toContain('oobari');
    expect(types).not.toContain('kobari');
  });

  it('runs cycle activities sequentially within one (block, level)', () => {
    const result = runSequencer({
      levels: ['1F'],
      blocks: ['A'],
      elements: [
        el('1F', 'A', 'hashira', 12),
        el('1F', 'A', 'oobari', 14),
        el('1F', 'A', 'kobari', 22),
      ],
      calendar: { startDateIso: '2026-05-07', workSaturday: false },
    });
    const acts = result.activities
      .filter((a) => a.block === 'A' && a.level === '1F')
      .sort((a, b) => a.startIso.localeCompare(b.startIso));
    expect(acts[0].elementType).toBe('hashira');
    expect(acts[1].elementType).toBe('oobari');
    expect(acts[2].elementType).toBe('kobari');
    // Each activity should start after the previous one's end.
    expect(acts[1].startIso >= acts[0].endIso).toBe(true);
    expect(acts[2].startIso >= acts[1].endIso).toBe(true);
  });

  it('block B starts after block A reaches the configured floor lag', () => {
    const result = runSequencer({
      levels: ['1F', '2F', '3F'],
      blocks: ['A', 'B'],
      elements: [
        el('1F', 'A', 'hashira', 12),
        el('2F', 'A', 'hashira', 12),
        el('3F', 'A', 'hashira', 12),
        el('1F', 'B', 'hashira', 12),
        el('2F', 'B', 'hashira', 12),
        el('3F', 'B', 'hashira', 12),
      ],
      calendar: { startDateIso: '2026-05-07', workSaturday: false },
    });
    const aFirst = result.activities.find((a) => a.block === 'A' && a.level === '1F');
    const bFirst = result.activities.find((a) => a.block === 'B' && a.level === '1F');
    expect(aFirst).toBeDefined();
    expect(bFirst).toBeDefined();
    expect(bFirst!.startIso > aFirst!.startIso).toBe(true);
  });

  it('emits per-day demand keyed by ISO date', () => {
    const result = runSequencer({
      levels: ['1F'],
      blocks: ['A'],
      elements: [el('1F', 'A', 'hashira', 24)],
      calendar: { startDateIso: '2026-05-07', workSaturday: false },
    });
    const dates = Object.keys(result.dailyDemand).sort();
    expect(dates.length).toBeGreaterThanOrEqual(2);
    let totalPieces = 0;
    for (const d of dates) {
      for (const dem of result.dailyDemand[d]) {
        totalPieces += dem.pieces;
      }
    }
    expect(totalPieces).toBe(24);
  });
});
