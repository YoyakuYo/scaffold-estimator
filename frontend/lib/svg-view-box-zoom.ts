export type SvgViewRect = { x: number; y: number; w: number; h: number };

export function zoomPanViewBox(
  base: SvgViewRect,
  zoom: number,
  pan: { x: number; y: number },
): SvgViewRect {
  const z = Math.min(8, Math.max(0.25, zoom));
  const cx = base.x + base.w / 2 + pan.x;
  const cy = base.y + base.h / 2 + pan.y;
  const nw = base.w / z;
  const nh = base.h / z;
  return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
}
