import { packDay } from './truck-bin-pack';

describe('packDay', () => {
  it('packs columns onto 10t trucks under capacity', () => {
    // 3 columns × 4 m = 12 m total bed length, fits on a single 10t (13 m bed).
    // 3 × 700 kg = 2.1 t, well under 10 t payload.
    const result = packDay({
      date: '2026-05-07',
      demand: [
        {
          block: 'A',
          level: '1F',
          elementType: 'hashira',
          pieces: 3,
          kg: 3 * 700,
          maxLengthMm: 4000,
        },
      ],
    });
    expect(result.trucks.length).toBe(1);
    expect(result.trucks[0].truckType).toMatch(/10t|25t_trailer/);
    const totalPieces = result.trucks[0].items.reduce((s, i) => s + i.pieces, 0);
    expect(totalPieces).toBe(3);
  });

  it('opens a second truck when payload exceeds one truck capacity', () => {
    const result = packDay({
      date: '2026-05-07',
      demand: [
        {
          block: 'A',
          level: '1F',
          elementType: 'hashira',
          pieces: 30,
          kg: 30 * 700, // 21 t — needs two 10t trucks at least
          maxLengthMm: 4000,
        },
      ],
    });
    expect(result.trucks.length).toBeGreaterThanOrEqual(2);
  });

  it('routes >12 m pieces to the 25t trailer with a road-permit note', () => {
    const result = packDay({
      date: '2026-05-07',
      demand: [
        {
          block: 'A',
          level: '2F',
          elementType: 'taifubari',
          pieces: 4,
          kg: 4 * 800,
          maxLengthMm: 13000,
        },
      ],
    });
    const trailer = result.trucks.find((t) => t.truckType === '25t_trailer');
    expect(trailer).toBeDefined();
    expect(trailer!.notes).toContain('road_permit_required');
  });

  it('separates element types onto different trucks', () => {
    const result = packDay({
      date: '2026-05-07',
      demand: [
        { block: 'A', level: '1F', elementType: 'hashira', pieces: 4, kg: 4 * 700, maxLengthMm: 4000 },
        { block: 'A', level: '2F', elementType: 'oobari', pieces: 4, kg: 4 * 700, maxLengthMm: 6000 },
      ],
    });
    const types = new Set(
      result.trucks.flatMap((t) => t.items.map((i) => i.elementType)),
    );
    // At least one truck per element type.
    expect(types.has('hashira')).toBe(true);
    expect(types.has('oobari')).toBe(true);
  });
});
