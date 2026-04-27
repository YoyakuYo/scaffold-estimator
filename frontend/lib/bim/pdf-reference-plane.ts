/**
 * Renders the first page of a PDF (in-browser, via `pdfjs-dist`) onto an
 * offscreen `<canvas>` so the BIM Viewer can drape it across a horizontal
 * "reference plane" in the 3D scene.
 *
 * Why a reference plane and not extruded geometry?
 *   PDFs are mostly opaque rasters with no usable layered geometry — even a
 *   "vector PDF" produced by AutoCAD is an image-like graphics-stream that
 *   cannot be reliably reverse-engineered into walls/columns/slabs without
 *   a full PDF→DXF converter (which is itself a non-trivial server-side
 *   binary, e.g. ODA File Converter).  Treating the PDF as a textured
 *   "blueprint floor" gives users an immediately useful overlay:
 *     - drop the PDF into the viewer
 *     - the page is laid flat at y = 0 with the correct aspect ratio
 *     - any IFC/DXF model loaded afterwards renders on top of it.
 *
 * The function is framework-agnostic — it never imports Three.js — so the
 * viewer page can decide how to wrap the canvas in a `CanvasTexture`.
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
}

const PDF_PT_TO_METRE = 0.0254 / 72; // 1pt = 1/72 inch; 1 inch = 0.0254 m
const TARGET_LONG_EDGE_PIXELS = 2400; // crisp enough for zoom; safely under WebGL texture limits.

/**
 * Render page 1 of a PDF to a canvas. The plane sizing assumes the PDF page
 * represents a real-world plan at unknown scale, so we map page-points
 * directly to metres (1pt = 0.353mm). Most architectural plans rendered at
 * A1/A0 will land at ~30–50m wide which is the same order of magnitude as
 * the buildings the viewer is built for.
 */
export async function renderPdfFirstPageToPlane(
  buffer: ArrayBuffer,
): Promise<PdfPlaneRenderResult> {
  // Load pdfjs-dist + worker lazily — keeps the BIM bundle slim.
  // Mirrors the worker setup used in `components/perimeter-tracer/PerimeterTracer.tsx`.
  const pdfjs = await import('pdfjs-dist');
  const pdfjsAny = pdfjs as any;
  if (pdfjsAny.GlobalWorkerOptions && !pdfjsAny.GlobalWorkerOptions.workerSrc) {
    pdfjsAny.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${pdfjsAny.version}/build/pdf.worker.min.mjs`;
  }

  // Important: pdfjs mutates the buffer (transfers ownership). Clone first.
  const safeBuf = buffer.slice(0);
  const loadingTask = pdfjs.getDocument({ data: safeBuf });
  const pdf = await loadingTask.promise;
  if (pdf.numPages < 1) {
    throw new Error('PDF has no pages');
  }
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const pageWidthPt = baseViewport.width;
  const pageHeightPt = baseViewport.height;

  // Compute the render scale so the long edge ~ TARGET_LONG_EDGE_PIXELS.
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
  };
}
