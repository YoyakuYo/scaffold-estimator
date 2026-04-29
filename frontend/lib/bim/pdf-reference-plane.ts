/**
 * Renders PDF pages (in-browser, via `pdfjs-dist`) onto an offscreen `<canvas>`
 * for a horizontal "reference plane" in the BIM viewer 3D scene.
 *
 * Multi-page: call `renderPdfPageToPlane` with `pageNumberOneBased` (1…N).
 * `renderPdfFirstPageToPlane` remains a convenience wrapper for page 1.
 */
export interface PdfPlaneRenderResult {
  /** Offscreen HTMLCanvasElement ready to be wrapped in a Three.js CanvasTexture. */
  canvas: HTMLCanvasElement;
  /** Suggested world-space width of the plane (metres). */
  worldWidth: number;
  /** Suggested world-space depth of the plane (metres). */
  worldDepth: number;
  /** Native PDF page dimensions (PDF units = 1/72 inch). */
  pageWidthPt: number;
  pageHeightPt: number;
  /** Rendered raster dimensions, after the DPR/quality scale. */
  pixelWidth: number;
  pixelHeight: number;
  /** Total pages in the document (for UI pagination). */
  numPages: number;
  /** Which page was rendered (clamped to 1…numPages). */
  renderedPage: number;
}

const PDF_PT_TO_METRE = 0.0254 / 72;
const TARGET_LONG_EDGE_PIXELS = 2400;

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  const pdfjsAny = pdfjs as any;
  if (pdfjsAny.GlobalWorkerOptions && !pdfjsAny.GlobalWorkerOptions.workerSrc) {
    pdfjsAny.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${pdfjsAny.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

/**
 * Render a single PDF page (1-based index) to a canvas.
 */
export async function renderPdfPageToPlane(
  buffer: ArrayBuffer,
  pageNumberOneBased: number,
): Promise<PdfPlaneRenderResult> {
  const pdfjs = await loadPdfJs();
  const safeBuf = buffer.slice(0);
  const loadingTask = pdfjs.getDocument({ data: safeBuf });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  if (numPages < 1) {
    throw new Error('PDF has no pages');
  }
  const pageIndex = Math.max(1, Math.min(Math.floor(pageNumberOneBased) || 1, numPages));
  const page = await pdf.getPage(pageIndex);
  const baseViewport = page.getViewport({ scale: 1 });
  const pageWidthPt = baseViewport.width;
  const pageHeightPt = baseViewport.height;

  const longEdgePt = Math.max(pageWidthPt, pageHeightPt);
  const renderScale = Math.max(1, Math.min(4, TARGET_LONG_EDGE_PIXELS / longEdgePt));
  const viewport = page.getViewport({ scale: renderScale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for PDF rendering');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  } as any).promise;

  return {
    canvas,
    worldWidth: pageWidthPt * PDF_PT_TO_METRE,
    worldDepth: pageHeightPt * PDF_PT_TO_METRE,
    pageWidthPt,
    pageHeightPt,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    numPages,
    renderedPage: pageIndex,
  };
}

/** Render page 1 only (backwards-compatible entry point). */
export async function renderPdfFirstPageToPlane(buffer: ArrayBuffer): Promise<PdfPlaneRenderResult> {
  return renderPdfPageToPlane(buffer, 1);
}
