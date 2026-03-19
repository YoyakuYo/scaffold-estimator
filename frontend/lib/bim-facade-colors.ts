/**
 * Sample dominant facade colors from an uploaded BIM / render image so the 3D view
 * can match that upload (per-file, client-side — no extra API).
 */

export interface BimFacadeColors {
  /** Lower / ground-band façade (hex #rrggbb) */
  lowerHex: string;
  /** Mid / upper façade */
  upperHex: string;
  /** Roof band */
  roofHex: string;
  /** Glass / window tint if detected */
  windowHex?: string;
  /** Window sill / frame */
  sillHex?: string;
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isLikelyBackground(r: number, g: number, b: number): boolean {
  return luminance(r, g, b) > 247 && Math.min(r, g, b) > 232;
}

function isLikelyInkLine(r: number, g: number, b: number): boolean {
  return luminance(r, g, b) < 42;
}

function medianChannel(values: number[]): number {
  if (values.length === 0) return 128;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** PNG/JPEG/WebP/GIF/BMP uploads only (not PDF/DXF/IFC). */
export function isRasterImageUpload(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
}

/**
 * Extract lower / upper / roof (and optional window) colors from image pixels.
 * Uses vertical bands inside the non-white content bbox — tuned for isometric & elevation renders.
 */
export async function extractBimFacadeColorsFromImageFile(
  file: File,
): Promise<BimFacadeColors | null> {
  if (!isRasterImageUpload(file)) return null;

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return null;
  }

  const maxSide = 520;
  let w = bmp.width;
  let h = bmp.height;
  const scale = Math.min(1, maxSide / Math.max(w, h, 1));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close?.();
    return null;
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let anyContent = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isLikelyBackground(r, g, b)) {
        anyContent = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!anyContent) return null;

  const pad = 3;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bh < 8 || bw < 8) return null;

  type SampleOpts = { blueish?: boolean };

  const sampleBand = (y0r: number, y1r: number, opts?: SampleOpts): { r: number; g: number; b: number } | null => {
    const y0 = minY + Math.floor(bh * y0r);
    const y1 = minY + Math.floor(bh * y1r);
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let y = Math.max(minY, y0); y <= Math.min(maxY, y1); y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (isLikelyBackground(r, g, b) || isLikelyInkLine(r, g, b)) continue;
        if (opts?.blueish) {
          if (!(b > r + 10 && b > g + 6 && b > 90 && r < 230)) continue;
        }
        rs.push(r);
        gs.push(g);
        bs.push(b);
      }
    }
    if (rs.length < 10) return null;
    return {
      r: medianChannel(rs),
      g: medianChannel(gs),
      b: medianChannel(bs),
    };
  };

  // Vertical bands inside content (isometric: roof top, upper stories, podium/base)
  const roof = sampleBand(0, 0.2) ?? sampleBand(0, 0.28);
  const upper = sampleBand(0.18, 0.52) ?? sampleBand(0.12, 0.55);
  const lower = sampleBand(0.48, 1) ?? sampleBand(0.42, 1);
  const windowSample = sampleBand(0.15, 0.9, { blueish: true });

  const base = lower ?? upper ?? roof;
  if (!base) return null;

  const roofC = roof ?? upper ?? base;
  const upperC = upper ?? lower ?? base;
  const lowerC = lower ?? upper ?? base;

  return {
    roofHex: toHex(roofC.r, roofC.g, roofC.b),
    upperHex: toHex(upperC.r, upperC.g, upperC.b),
    lowerHex: toHex(lowerC.r, lowerC.g, lowerC.b),
    ...(windowSample && {
      windowHex: toHex(windowSample.r, windowSample.g, windowSample.b),
    }),
    sillHex: '#2d3748',
  };
}

/** Parse #rrggbb to Three.js 0xrrggbb */
export function bimHexToNumber(hex: string | undefined, fallback: number): number {
  if (!hex || typeof hex !== 'string') return fallback;
  const s = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return fallback;
  return parseInt(s, 16);
}
