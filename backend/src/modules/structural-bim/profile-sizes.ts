/**
 * Map profile names to rectangle or rolled H-style I dimensions (mm).
 * I-shape uses IFC IfcIShapeProfileDef; rectangles use IfcRectangleProfileDef.
 */

export type ProfileKind = 'rectangle' | 'ishape';

export interface RectangleProfileMm {
  kind: 'rectangle';
  bMm: number;
  dMm: number;
}

export interface IShapeProfileMm {
  kind: 'ishape';
  /** Overall section depth (strong axis), mm */
  depthMm: number;
  /** Flange pair width, mm */
  widthMm: number;
  webMm: number;
  flangeMm: number;
}

export type ProfileSpec = RectangleProfileMm | IShapeProfileMm;

/** Legacy helper — bounding rectangle for quick checks. */
export function profileRectangleMm(profileName: string): { bMm: number; dMm: number } {
  const s = profileSpec(profileName);
  if (s.kind === 'rectangle') return { bMm: s.bMm, dMm: s.dMm };
  return { bMm: s.widthMm, dMm: s.depthMm };
}

/**
 * H400x200, H-400X200, 400x200 → I-shape with inferred web/flange thickness.
 * Plain numbers without H prefix still match as rectangle-ish box unless two numbers with x.
 */
export function profileSpec(profileName: string): ProfileSpec {
  const raw = profileName.trim();
  const u = raw.toUpperCase();
  const m = u.match(/(\d+)\s*[Xx×]\s*(\d+)/);
  if (!m) {
    return { kind: 'rectangle', bMm: 200, dMm: 200 };
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  const depth = Math.max(a, b);
  const width = Math.min(a, b);
  const looksH = /^H[\s\-]?/i.test(raw) || u.includes('H') || depth >= 150;
  if (looksH || depth >= 200) {
    const web = Math.max(6, Math.round(depth * 0.028));
    const flange = Math.max(8, Math.round(depth * 0.045));
    return {
      kind: 'ishape',
      depthMm: depth,
      widthMm: width,
      webMm: web,
      flangeMm: flange,
    };
  }
  return { kind: 'rectangle', bMm: width, dMm: depth };
}
