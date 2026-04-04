/**
 * Build a single closed polygon footprint from quick-shape side lengths (mm).
 * Vertices are ordered so edge i is vertex[i] → vertex[(i+1) % n].
 */
export function buildQuickShapeFootprintMm(
  shapeType: 'rectangle' | 'l-shape' | 'custom',
  sides: Array<{ lengthMm: number }>,
): Array<{ x: number; y: number }> {
  if (sides.length < 3) return [];

  if (shapeType === 'rectangle' && sides.length === 4) {
    const w = sides[0].lengthMm;
    const d = sides[1].lengthMm;
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ];
  }

  if (shapeType === 'l-shape' && sides.length === 6) {
    const [ab, bc, cd, de, ef] = sides.map((s) => s.lengthMm);
    return [
      { x: 0, y: 0 },
      { x: ab, y: 0 },
      { x: ab, y: bc },
      { x: ab + cd, y: bc },
      { x: ab + cd, y: bc - de },
      { x: ab + cd - ef, y: bc - de },
    ];
  }

  const n = sides.length;
  const extAngle = (2 * Math.PI) / n;
  let angle = 0;
  let cx = 0;
  let cy = 0;
  const vertices: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (let i = 0; i < n - 1; i++) {
    const len = sides[i].lengthMm;
    cx += len * Math.cos(angle);
    cy += len * Math.sin(angle);
    angle += extAngle;
    vertices.push({ x: cx, y: cy });
  }
  return vertices;
}
