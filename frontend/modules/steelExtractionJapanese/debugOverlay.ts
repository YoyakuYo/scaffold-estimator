import type { SteelExtractionResult } from './types';

export interface DebugSvgOptions {
  /** Extra margin around content bbox */
  padding: number;
  /** Stroke width in SVG units */
  strokeWidth: number;
  /** If true, flip Y so SVG screen coords match DXF Y-up */
  flipY: boolean;
}

const DEFAULT_DEBUG_OPTS: DebugSvgOptions = {
  padding: 500,
  strokeWidth: 2,
  flipY: true,
};

function collectBounds(result: SteelExtractionResult): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const bump = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const fr of Object.values(result.floors)) {
    for (const blk of Object.values(fr.blocks)) {
      for (const b of blk.beams) {
        bump(b.start[0], b.start[1]);
        bump(b.end[0], b.end[1]);
      }
      for (const c of blk.columns) {
        bump(c.position[0], c.position[1]);
      }
      for (const br of blk.braces) {
        bump(br.start[0], br.start[1]);
        bump(br.end[0], br.end[1]);
      }
    }
  }

  for (const g of result.meta.gridCells) {
    bump(g.x, g.y);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  }
  return { minX, minY, maxX, maxY };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * SVG overlay: beams blue, columns red, braces green; labels + section annotations.
 */
export function buildSteelExtractionDebugSvg(
  result: SteelExtractionResult,
  opts?: Partial<DebugSvgOptions>,
): string {
  const o = { ...DEFAULT_DEBUG_OPTS, ...opts };
  const { minX, minY, maxX, maxY } = collectBounds(result);
  const pad = o.padding;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;

  const tx = (x: number) => x - minX + pad;
  /** DXF is typically Y-up; SVG is Y-down. */
  const ty = (y: number) => (o.flipY ? pad + (maxY - y) : y - minY + pad);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="background:#1a1a1a">`,
  );
  parts.push(
    `<g fill="none" stroke-width="${o.strokeWidth}" stroke-linecap="round" font-family="system-ui,sans-serif" font-size="11">`,
  );

  for (const g of result.meta.gridCells) {
    const x = tx(g.x);
    const y = ty(g.y);
    parts.push(
      `<circle cx="${x}" cy="${y}" r="6" stroke="#888" fill="none"/><text x="${x + 8}" y="${y - 8}" fill="#ccc">${esc(g.id)}</text>`,
    );
  }

  for (const fr of Object.values(result.floors)) {
    for (const blk of Object.values(fr.blocks)) {
      for (const b of blk.beams) {
        const x1 = tx(b.start[0]);
        const y1 = ty(b.start[1]);
        const x2 = tx(b.end[0]);
        const y2 = ty(b.end[1]);
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#4da3ff"/>`);
        const lx = (x1 + x2) / 2;
        const ly = (y1 + y2) / 2;
        const cap = [b.label, b.section].filter(Boolean).join(' ');
        if (cap) parts.push(`<text x="${lx}" y="${ly - 6}" fill="#a8d4ff">${esc(cap)}</text>`);
      }
      for (const c of blk.columns) {
        const x = tx(c.position[0]);
        const y = ty(c.position[1]);
        parts.push(`<circle cx="${x}" cy="${y}" r="8" stroke="#ff5c5c" fill="rgba(255,92,92,0.15)"/>`);
        const cap = [c.label, c.section].filter(Boolean).join(' ');
        if (cap) parts.push(`<text x="${x + 10}" y="${y}" fill="#ffb3b3">${esc(cap)}</text>`);
      }
      for (const br of blk.braces) {
        const x1 = tx(br.start[0]);
        const y1 = ty(br.start[1]);
        const x2 = tx(br.end[0]);
        const y2 = ty(br.end[1]);
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5cff8a"/>`);
        const lx = (x1 + x2) / 2;
        const ly = (y1 + y2) / 2;
        const cap = [br.label, br.section].filter(Boolean).join(' ');
        if (cap) parts.push(`<text x="${lx}" y="${ly - 6}" fill="#b3ffd0">${esc(cap)}</text>`);
      }
    }
  }

  parts.push(`</g></svg>`);
  return parts.join('');
}
