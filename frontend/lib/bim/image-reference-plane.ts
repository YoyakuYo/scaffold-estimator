/**
 * Renders raster images (PNG, JPEG, WebP, GIF, BMP) onto a canvas for the same
 * horizontal reference plane used by PDFs in the BIM viewer.
 *
 * Physical scale: there is no embedded drawing unit in a bare PNG/JPEG. We map the
 * image's long edge to {@link REFERENCE_PLANE_LONG_EDGE_METERS} so floor-plan style
 * sheets sit at a comfortable orbit scale (same order of magnitude as PDF pt→m mapping).
 */

export interface RasterPlaneRenderResult {
  canvas: HTMLCanvasElement;
  worldWidth: number;
  worldDepth: number;
  pixelWidth: number;
  pixelHeight: number;
}

const TARGET_LONG_EDGE_PIXELS = 2400;
/** Meters along the longer axis of the raster on the ground plane. */
export const REFERENCE_PLANE_LONG_EDGE_METERS = 24;

export function mimeTypeForRasterExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}

function drawImageToCanvas(img: CanvasImageSource, srcW: number, srcH: number): HTMLCanvasElement {
  const longEdge = Math.max(srcW, srcH);
  const scale = Math.min(1, TARGET_LONG_EDGE_PIXELS / longEdge);
  const cw = Math.max(1, Math.round(srcW * scale));
  const ch = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for image plane');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas;
}

function planeMetrics(cw: number, ch: number): Pick<RasterPlaneRenderResult, 'worldWidth' | 'worldDepth'> {
  const maxDim = Math.max(cw, ch);
  return {
    worldWidth: (cw / maxDim) * REFERENCE_PLANE_LONG_EDGE_METERS,
    worldDepth: (ch / maxDim) * REFERENCE_PLANE_LONG_EDGE_METERS,
  };
}

/**
 * Decode `buffer` as an image and render to a canvas suitable for {@link THREE.CanvasTexture}.
 */
export async function renderRasterImageToPlane(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<RasterPlaneRenderResult> {
  const safeType = mimeType?.trim() || 'image/png';
  const blob = new Blob([buffer.slice(0)], { type: safeType });

  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      try {
        const canvas = drawImageToCanvas(bmp, bmp.width, bmp.height);
        const { worldWidth, worldDepth } = planeMetrics(canvas.width, canvas.height);
        return {
          canvas,
          worldWidth,
          worldDepth,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
        };
      } finally {
        bmp.close();
      }
    } catch {
      // fall through to HTMLImageElement
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image (unsupported or corrupt file)'));
      el.src = url;
    });
    const canvas = drawImageToCanvas(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
    const { worldWidth, worldDepth } = planeMetrics(canvas.width, canvas.height);
    return {
      canvas,
      worldWidth,
      worldDepth,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
