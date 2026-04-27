import { buildWorkingCalendar } from './calendar';

describe('working calendar', () => {
  const cal = buildWorkingCalendar({
    startDateIso: '2026-05-01',
    workSaturday: true,
    workSunday: false,
  });

  it('flags Sundays as non-working', () => {
    expect(cal.isWorking('2026-05-03')).toBe(false); // Sunday
  });

  it('treats Saturdays as working when workSaturday=true', () => {
    expect(cal.isWorking('2026-05-02')).toBe(true); // Saturday
  });

  it('blocks JP holidays from the seeded list', () => {
    expect(cal.isWorking('2026-05-03')).toBe(false); // Constitution Day (Sunday + holiday)
    expect(cal.isWorking('2026-05-04')).toBe(false); // Greenery Day Mon holiday
    expect(cal.isWorking('2026-05-05')).toBe(false); // Children's Day
    expect(cal.isWorking('2026-05-06')).toBe(false); // 振替休日
  });

  it('next() skips non-working days', () => {
    // Friday May 1 → next working day is Saturday May 2 (workSaturday=true).
    expect(cal.next('2026-05-01')).toBe('2026-05-02');
    // Saturday May 2 → next is Tuesday May 7 because May 3-6 are all holidays.
    expect(cal.next('2026-05-02')).toBe('2026-05-07');
  });

  it('add(n) advances n business days', () => {
    // Starting Tuesday May 7, +5 working days lands ~ Monday May 11 + extras.
    const after = cal.add('2026-05-07', 5);
    expect(after >= '2026-05-13').toBe(true);
  });

  it('range expands inclusive iso range', () => {
    const r = cal.range('2026-05-01', '2026-05-04');
    expect(r).toEqual(['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04']);
  });

  it('honours extra holidays passed in', () => {
    const cal2 = buildWorkingCalendar({
      startDateIso: '2026-05-01',
      workSaturday: false,
      extraHolidaysIso: ['2026-05-15'],
    });
    expect(cal2.isWorking('2026-05-15')).toBe(false);
  });
});
