import { randomUUID } from 'crypto';
import type { StructuralMember, StructuralModel } from './structural-model.types';

/**
 * Phase 2 — CSV member rows merged into an existing model (grids/storeys unchanged).
 *
 * Header (required):
 * mark,category,profile,storeyId,xLabel,yLabel,x2Label,y2Label
 *
 * category: column | beam
 * x2Label,y2Label: empty for columns
 */
export function mergeMembersFromCsv(model: StructuralModel, csvText: string): StructuralModel {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV needs a header row and at least one data row.');
  }
  const header = lines[0]!.toLowerCase().split(',').map((c) => c.trim());
  const idx = (name: string) => {
    const i = header.indexOf(name.toLowerCase());
    if (i < 0) throw new Error(`Missing column: ${name}`);
    return i;
  };
  const iMark = idx('mark');
  const iCat = idx('category');
  const iProf = idx('profile');
  const iStorey = idx('storeyid');
  const iX = idx('xlabel');
  const iY = idx('ylabel');
  const iX2 = header.indexOf('x2label');
  const iY2 = header.indexOf('y2label');

  const members: StructuralMember[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r]!.split(',').map((c) => c.trim());
    const mark = cols[iMark] ?? '';
    const cat = (cols[iCat] ?? '').toLowerCase();
    const profile = cols[iProf] ?? '';
    const storeyId = cols[iStorey] ?? '';
    const xLabel = cols[iX] ?? '';
    const yLabel = cols[iY] ?? '';
    if (!mark || !profile || !storeyId || !xLabel || !yLabel) continue;
    if (cat !== 'column' && cat !== 'beam') continue;

    const base = {
      id: `csv-${randomUUID()}`,
      mark,
      category: cat as 'column' | 'beam',
      profileName: profile,
      storeyId,
      start: { xLabel, yLabel },
    };
    if (cat === 'column') {
      members.push(base);
    } else {
      const x2 = iX2 >= 0 ? cols[iX2] : '';
      const y2 = iY2 >= 0 ? cols[iY2] : '';
      if (!x2 || !y2) continue;
      members.push({ ...base, end: { xLabel: x2, yLabel: y2 } });
    }
  }

  if (!members.length) throw new Error('No valid member rows parsed from CSV.');

  return {
    ...model,
    members,
  };
}
