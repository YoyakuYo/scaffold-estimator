'use client';

/**
 * ═══════════════════════════════════════════════════════════
 * Perimeter Tracer — Split-Screen Building Outline Editor
 * ═══════════════════════════════════════════════════════════
 *
 * LEFT panel:  Uploaded drawing (image / PDF / DXF) with
 *              interactive point-click overlay.
 * RIGHT panel: Live perimeter preview, segment dimensions,
 *              building height input.
 *
 * Modes:
 *   DXF  → auto-detect outer polygon, render all geometry
 *   Image/PDF → user clicks corners, calibrate or manual dims
 *   DWG  → rejected with message
 */

import React, {
  useState, useRef, useCallback, useEffect, useMemo,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { PerimeterModel } from '@/lib/perimeter-model';
import { parseDxfFile } from '@/cad/parseDxf';
import { extractSegments } from '@/cad/extractSegments';
import { detectOuterPolygon } from '@/geometry/polygonDetection';
import {
  Upload, Loader2, AlertCircle, Ruler, RotateCcw,
  Trash2, CheckCircle2, Maximize2, FileUp,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { drawingsApi, ExtractedDimensions } from '@/lib/api/drawings';

// ─── Types ─────────────────────────────────────────────────

interface TracerPoint {
  x: number;          // canvas-space coordinate
  y: number;
  label: string;      // A, B, C …
}

interface TracerSegment {
  from: TracerPoint;
  to: TracerPoint;
  fromLabel: string;
  toLabel: string;
  pxDist: number;
  mm: number;
  confirmed: boolean;
}

type FileMode = 'image' | 'dxf';
type CalibPhase = 'off' | 'point1' | 'point2' | 'input';

// ─── Helpers ───────────────────────────────────────────────

function ptLabel(i: number): string {
  if (i < 26) return String.fromCharCode(65 + i);
  return ptLabel(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

function ptDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ─── Snap Engine ────────────────────────────────────────────

/** Snap thresholds in canvas-space pixels (before zoom) */
const ORTHO_SNAP_DEG = 5;       // degrees tolerance for angle snapping
const ALIGN_SNAP_PX = 12;       // pixel tolerance for alignment guides
const ANGLE_STEPS = [0, 45, 90, 135, 180, 225, 270, 315]; // snap angles

interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  snappedOrtho: boolean;
  snappedAlign: boolean;
  angle: number | null;        // degrees from last point, null if no last point
  distance: number | null;     // px distance from last point
}

interface SnapGuide {
  type: 'horizontal' | 'vertical' | 'angle';
  x1: number; y1: number;
  x2: number; y2: number;
  label?: string;
  sourceLabel?: string;        // which point this guide comes from
}

function computeSnap(
  raw: { x: number; y: number },
  lastPt: TracerPoint | null,
  allPoints: TracerPoint[],
  snapThreshold: number,
  shiftHeld: boolean,
): SnapResult {
  let sx = raw.x;
  let sy = raw.y;
  const guides: SnapGuide[] = [];
  let snappedOrtho = false;
  let snappedAlign = false;
  let angle: number | null = null;
  let distance: number | null = null;

  // ── 1. Alignment guides: snap to any existing point's X or Y ──
  // Collect all candidate snap axes from existing points
  const xSnaps: { val: number; label: string }[] = [];
  const ySnaps: { val: number; label: string }[] = [];
  for (const pt of allPoints) {
    if (Math.abs(raw.x - pt.x) < snapThreshold) {
      xSnaps.push({ val: pt.x, label: pt.label });
    }
    if (Math.abs(raw.y - pt.y) < snapThreshold) {
      ySnaps.push({ val: pt.y, label: pt.label });
    }
  }

  // Apply closest X alignment
  if (xSnaps.length > 0) {
    const best = xSnaps.reduce((a, b) =>
      Math.abs(raw.x - a.val) < Math.abs(raw.x - b.val) ? a : b,
    );
    sx = best.val;
    snappedAlign = true;
    // Find the source point for the guide line
    const srcPt = allPoints.find(p => p.label === best.label)!;
    guides.push({
      type: 'vertical',
      x1: best.val, y1: Math.min(srcPt.y, sy) - 2000,
      x2: best.val, y2: Math.max(srcPt.y, sy) + 2000,
      sourceLabel: best.label,
    });
  }

  // Apply closest Y alignment
  if (ySnaps.length > 0) {
    const best = ySnaps.reduce((a, b) =>
      Math.abs(raw.y - a.val) < Math.abs(raw.y - b.val) ? a : b,
    );
    sy = best.val;
    snappedAlign = true;
    const srcPt = allPoints.find(p => p.label === best.label)!;
    guides.push({
      type: 'horizontal',
      x1: Math.min(srcPt.x, sx) - 2000, y1: best.val,
      x2: Math.max(srcPt.x, sx) + 2000, y2: best.val,
      sourceLabel: best.label,
    });
  }

  // ── 2. Ortho snap from last point ──
  if (lastPt) {
    const dx = sx - lastPt.x;
    const dy = sy - lastPt.y;
    const rawAngle = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
    const dist = Math.hypot(dx, dy);
    distance = dist;
    angle = rawAngle;

    if (shiftHeld) {
      // Hard ortho lock: snap to nearest 45° angle
      let bestAngle = 0;
      let bestDiff = 360;
      for (const a of ANGLE_STEPS) {
        const diff = Math.abs(((rawAngle - a + 180) % 360) - 180);
        if (diff < bestDiff) { bestDiff = diff; bestAngle = a; }
      }
      const rad = bestAngle * Math.PI / 180;
      sx = lastPt.x + dist * Math.cos(rad);
      sy = lastPt.y - dist * Math.sin(rad);
      angle = bestAngle;
      snappedOrtho = true;
    } else {
      // Soft ortho: snap if very close to H/V/45° axis
      for (const a of ANGLE_STEPS) {
        const diff = Math.abs(((rawAngle - a + 180) % 360) - 180);
        if (diff < ORTHO_SNAP_DEG) {
          const rad = a * Math.PI / 180;
          sx = lastPt.x + dist * Math.cos(rad);
          sy = lastPt.y - dist * Math.sin(rad);
          angle = a;
          snappedOrtho = true;
          break;
        }
      }
    }

    // Add ortho guide line from last point through snapped position
    if (snappedOrtho) {
      const ext = 3000; // extend the guide line
      const dx2 = sx - lastPt.x;
      const dy2 = sy - lastPt.y;
      const len = Math.hypot(dx2, dy2) || 1;
      const ux = dx2 / len;
      const uy = dy2 / len;
      guides.push({
        type: 'angle',
        x1: lastPt.x - ux * ext, y1: lastPt.y - uy * ext,
        x2: lastPt.x + ux * ext, y2: lastPt.y + uy * ext,
        label: `${Math.round(angle!)}°`,
      });
    }
  }

  return { x: sx, y: sy, guides, snappedOrtho, snappedAlign, angle, distance };
}

async function renderPdfToImage(file: File): Promise<string | null> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const pdfjsAny = pdfjs as any;
    if (pdfjsAny.GlobalWorkerOptions && !pdfjsAny.GlobalWorkerOptions.workerSrc) {
      pdfjsAny.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${pdfjsAny.version}/build/pdf.worker.min.mjs`;
    }
    const task = pdfjsAny.getDocument({ data: await file.arrayBuffer() });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    await pdf.destroy();
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

// ─── Props ─────────────────────────────────────────────────

export interface PerimeterTracerProps {
  perimeterModel: PerimeterModel;
  onWallsDetected?: (
    walls: Array<{ side: string; lengthMm: number }>,
    vertices?: Array<{ x: number; y: number }>,
  ) => void;
  /** Called when a segment dimension is edited in the right panel */
  onSegmentEdit?: (index: number, lengthMm: number) => void;
  /** External wall lengths (from wall config below) — synced into manualDims */
  externalWallLengths?: number[];
  buildingHeightMm: number | null;
  onBuildingHeightChange?: (h: number | null) => void;
}

// ─── Component ─────────────────────────────────────────────

export function PerimeterTracer({
  perimeterModel,
  onWallsDetected,
  onSegmentEdit,
  externalWallLengths,
  buildingHeightMm,
  onBuildingHeightChange,
}: PerimeterTracerProps) {
  const { t, locale } = useI18n();
  /* ───── File state ──────────────────────────────────────── */
  const [phase, setPhase] = useState<'upload' | 'loaded'>('upload');
  const [fileName, setFileName] = useState('');
  const [fileMode, setFileMode] = useState<FileMode | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [canvasW, setCanvasW] = useState(0);
  const [canvasH, setCanvasH] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ───── DXF state ───────────────────────────────────────── */
  const [dxfDisplaySegs, setDxfDisplaySegs] = useState<
    Array<{ x1: number; y1: number; x2: number; y2: number }>
  >([]);
  const dxfBBoxRef = useRef<{
    minX: number; minY: number; maxX: number; maxY: number;
  } | null>(null);

  /* ───── Tracer state ────────────────────────────────────── */
  const [points, setPoints] = useState<TracerPoint[]>([]);
  const [closed, setClosed] = useState(false);
  const [manualDims, setManualDims] = useState<Record<number, number>>({});
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredPt, setHoveredPt] = useState<number | null>(null);
  const [draggingPt, setDraggingPt] = useState<number | null>(null);

  /* ───── Inline segment edit popup ─────────────────────── */
  const [editingSegIdx, setEditingSegIdx] = useState<number | null>(null);
  const [editingSegVal, setEditingSegVal] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the inline edit input when popup opens
  useEffect(() => {
    if (editingSegIdx !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSegIdx]);

  /* ───── Snap state ───────────────────────────────────────── */
  const [shiftHeld, setShiftHeld] = useState(false);
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null);

  /* ───── Calibration ─────────────────────────────────────── */
  const [calib, setCalib] = useState<{ mmPerPixel: number } | null>(null);
  const [calibPhase, setCalibPhase] = useState<CalibPhase>('off');
  const [calibPts, setCalibPts] = useState<{ x: number; y: number }[]>([]);
  const [calibInput, setCalibInput] = useState('');

  /* ───── Server extraction state ─────────────────────────── */
  const [extracting, setExtracting] = useState(false);
  const [extractedDims, setExtractedDims] = useState<ExtractedDimensions | null>(null);

  /* ───── Canvas view ─────────────────────────────────────── */
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  /* ───── Refs ────────────────────────────────────────────── */
  const canvasRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<string | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const isMouseDownRef = useRef(false);   // true only while left button held
  const isPanningRef = useRef(false);
  const mouseMovedRef = useRef(false);

  // Stable ref for parent callback (avoids stale-closure in effects)
  const wallsCbRef = useRef(onWallsDetected);
  useEffect(() => { wallsCbRef.current = onWallsDetected; });

  /* ───── Sync external wall lengths into manualDims ─────── */
  const externalSyncRef = useRef(false);
  useEffect(() => {
    if (!externalWallLengths || externalWallLengths.length === 0) return;
    // Only apply if user edited a wall below (avoid infinite loop from our own edits)
    const newDims: Record<number, number> = {};
    let changed = false;
    externalWallLengths.forEach((len, i) => {
      if (len > 0 && manualDims[i] !== len) {
        newDims[i] = len;
        changed = true;
      }
    });
    if (changed) {
      externalSyncRef.current = true;
      setManualDims(prev => ({ ...prev, ...newDims }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalWallLengths]);

  /* ───── Shift key tracking for ortho snap ────────────────── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  /* ───── Cleanup ─────────────────────────────────────────── */
  useEffect(() => {
    return () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); };
  }, []);

  /* ═══════════════════════════════════════════════════════════
     COMPUTED
     ═══════════════════════════════════════════════════════════ */

  const segments: TracerSegment[] = useMemo(() => {
    const segs: TracerSegment[] = [];
    const n = closed ? points.length : Math.max(0, points.length - 1);
    for (let i = 0; i < n; i++) {
      const from = points[i];
      const to = points[(i + 1) % points.length];
      const pxDist = ptDist(from, to);
      let mm = 0;
      let confirmed = false;

      // Manual override always wins (user typed a value)
      if (manualDims[i] !== undefined && manualDims[i] > 0) {
        mm = manualDims[i];
        confirmed = true;
      } else if (fileMode === 'dxf') {
        mm = Math.round(pxDist);
        confirmed = true;
      } else if (calib) {
        mm = Math.round(pxDist * calib.mmPerPixel);
        confirmed = true;
      }
      segs.push({ from, to, fromLabel: from.label, toLabel: to.label, pxDist, mm, confirmed });
    }
    return segs;
  }, [points, closed, fileMode, calib, manualDims]);

  const totalPerimeter = useMemo(
    () => segments.reduce((s, seg) => s + seg.mm, 0),
    [segments],
  );

  const allConfirmed = useMemo(
    () => closed && segments.length >= 3 && segments.every(s => s.confirmed && s.mm > 0),
    [closed, segments],
  );

  /* ═══════════════════════════════════════════════════════════
     SYNC TO PERIMETER MODEL
     ═══════════════════════════════════════════════════════════ */

  // Populate walls as soon as polygon is closed (even with 0 lengths)
  // so user can edit lengths in the wall config below
  useEffect(() => {
    if (!closed || segments.length < 3) return;

    let modelPts: { x: number; y: number }[];
    if (fileMode === 'dxf' && dxfBBoxRef.current) {
      const bb = dxfBBoxRef.current;
      modelPts = points.map(p => ({ x: p.x + bb.minX, y: bb.maxY - p.y }));
    } else if (calib) {
      modelPts = points.map(p => ({
        x: p.x * calib.mmPerPixel,
        y: p.y * calib.mmPerPixel,
      }));
    } else {
      modelPts = points.map(p => ({ x: p.x, y: p.y }));
    }

    perimeterModel.loadFromPoints(modelPts);

    // Override lengths for manually-entered dimensions
    segments.forEach((seg, i) => {
      if (seg.mm > 0) perimeterModel.updateSegmentLength(i, seg.mm);
    });

    // Build normalized vertex positions (in mm) for plan/3D views
    // We reconstruct vertices from actual angles between consecutive segments
    const verticesMm: { x: number; y: number }[] = [];
    if (points.length >= 3) {
      // Use the actual point positions to compute relative angles,
      // then combine with real mm lengths to build a scaled polygon
      for (let i = 0; i < points.length; i++) {
        if (i === 0) {
          verticesMm.push({ x: 0, y: 0 });
        } else {
          const prev = points[i - 1];
          const curr = points[i];
          // Compute angle from canvas-space points (preserves shape)
          const angle = Math.atan2(curr.y - prev.y, curr.x - prev.x);
          // Use the real mm length for this segment
          const lenMm = segments[i - 1]?.mm || 0;
          const lastV = verticesMm[i - 1];
          verticesMm.push({
            x: lastV.x + lenMm * Math.cos(angle),
            y: lastV.y + lenMm * Math.sin(angle),
          });
        }
      }
    }

    wallsCbRef.current?.(
      segments.map((s, i) => ({ side: `edge-${i}`, lengthMm: s.mm })),
      verticesMm,
    );
  }, [closed, segments, points, fileMode, calib, perimeterModel]);

  /* ═══════════════════════════════════════════════════════════
     FILE PROCESSING
     ═══════════════════════════════════════════════════════════ */

  const fitCanvas = useCallback(() => {
    const el = canvasRef.current;
    if (!el || !canvasW || !canvasH) return;
    const r = el.getBoundingClientRect();
    const z = Math.min((r.width - 40) / canvasW, (r.height - 40) / canvasH);
    setPanX((r.width - canvasW * z) / 2);
    setPanY((r.height - canvasH * z) / 2);
    setZoom(z);
  }, [canvasW, canvasH]);

  // Auto-fit when loaded
  useEffect(() => {
    if (phase === 'loaded' && canvasW > 0 && canvasH > 0) {
      requestAnimationFrame(fitCanvas);
    }
  }, [phase, fitCanvas, canvasW, canvasH]);

  const resetTracer = useCallback(() => {
    setPoints([]);
    setClosed(false);
    setManualDims({});
    setCalib(null);
    setCalibPhase('off');
    setCalibPts([]);
    setCalibInput('');
    setCursorPos(null);
    setHoveredPt(null);
    setDraggingPt(null);
  }, []);

  const handleReset = useCallback(() => {
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    setPhase('upload');
    setFileName('');
    setFileMode(null);
    setImageUrl(null);
    setCanvasW(0);
    setCanvasH(0);
    setErrorMsg(null);
    setDxfDisplaySegs([]);
    dxfBBoxRef.current = null;
    resetTracer();
    perimeterModel.clear();
  }, [perimeterModel, resetTracer]);

  const handleDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    setFileName(file.name);
    setErrorMsg(null);
    resetTracer();

    if (ext === 'dwg') {
      setErrorMsg(
        locale === 'ja'
          ? 'DWG形式は直接読み込めません。CADソフトからDXF形式でエクスポートしてください。'
          : 'DWG format cannot be read directly. Please export as DXF from your CAD software.',
      );
      return;
    }
    if (ext === 'jww') {
      setErrorMsg(
        locale === 'ja'
          ? 'JWW形式は直接読み込めません。Jw_cadからDXF形式でエクスポートしてください。'
          : 'JWW format cannot be read directly. Please export as DXF from Jw_cad.',
      );
      return;
    }

    setIsLoading(true);
    try {
      if (ext === 'dxf') {
        /* ── DXF ─────────────────────────────────────────── */
        const dxf = await parseDxfFile(file);
        const extr = extractSegments(dxf);
        if (extr.segments.length === 0) {
          setErrorMsg(t('viewer', 'noLineGeometry'));
          return;
        }

        // Scale normalization
        let segs = extr.segments;
        const xs0 = segs.flatMap(s => [s.start.x, s.end.x]);
        const ys0 = segs.flatMap(s => [s.start.y, s.end.y]);
        const bw = Math.max(...xs0) - Math.min(...xs0);
        let sc = 1;
        if (bw > 0 && bw < 100) sc = 1000; // assume meters → mm
        if (sc !== 1) {
          segs = segs.map(s => ({
            start: { x: s.start.x * sc, y: s.start.y * sc },
            end: { x: s.end.x * sc, y: s.end.y * sc },
          }));
        }

        // Bounding box
        const xs = segs.flatMap(s => [s.start.x, s.end.x]);
        const ys = segs.flatMap(s => [s.start.y, s.end.y]);
        const bb = {
          minX: Math.min(...xs), minY: Math.min(...ys),
          maxX: Math.max(...xs), maxY: Math.max(...ys),
        };
        dxfBBoxRef.current = bb;
        const cw = bb.maxX - bb.minX || 1;
        const ch = bb.maxY - bb.minY || 1;
        setCanvasW(cw);
        setCanvasH(ch);

        // Transform to canvas coords (Y-flip, offset to 0,0)
        setDxfDisplaySegs(segs.map(s => ({
          x1: s.start.x - bb.minX, y1: bb.maxY - s.start.y,
          x2: s.end.x - bb.minX, y2: bb.maxY - s.end.y,
        })));

        // Auto-detect outer polygon
        const poly = detectOuterPolygon(segs);
        if (poly && poly.points.length >= 3) {
          setPoints(poly.points.map((p, i) => ({
            x: p.x - bb.minX,
            y: bb.maxY - p.y,
            label: ptLabel(i),
          })));
          setClosed(true);
        }

        setFileMode('dxf');
        setPhase('loaded');

      } else if (ext === 'pdf') {
        /* ── PDF ─────────────────────────────────────────── */
        const url = await renderPdfToImage(file);
        if (!url) { setErrorMsg(t('viewer', 'pdfRenderFailed')); return; }
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        blobRef.current = url;
        const img = new Image();
        img.src = url;
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); });
        setImageUrl(url);
        setCanvasW(img.naturalWidth);
        setCanvasH(img.naturalHeight);
        setFileMode('image');
        setPhase('loaded');
        attemptServerExtraction(file);

      } else {
        /* ── Image ────────────────────────────────────────── */
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        const url = URL.createObjectURL(file);
        blobRef.current = url;
        const img = new Image();
        img.src = url;
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); });
        setImageUrl(url);
        setCanvasW(img.naturalWidth);
        setCanvasH(img.naturalHeight);
        setFileMode('image');
        setPhase('loaded');
        attemptServerExtraction(file);
      }
    } catch (err) {
      setErrorMsg(`${t('viewer', 'processingError')}: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setIsLoading(false);
    }
  }, [resetTracer, t]);

  const attemptServerExtraction = useCallback(async (file: File) => {
    setExtracting(true);
    try {
      const result = await drawingsApi.upload(file, 'perimeter-trace');
      if (result.extractedDimensions) {
        setExtractedDims(result.extractedDimensions);
        const dims = result.extractedDimensions;
        const wallOrder = [dims.walls.north, dims.walls.east, dims.walls.south, dims.walls.west];
        const validWalls = wallOrder.filter(w => w && w.lengthMm > 0);
        if (validWalls.length >= 2) {
          const newDims: Record<number, number> = {};
          validWalls.forEach((w, i) => {
            if (w) {
              newDims[i] = w.lengthMm;
              onSegmentEdit?.(i, w.lengthMm);
            }
          });
          setManualDims(prev => ({ ...prev, ...newDims }));
        }
        if (dims.buildingHeightMm && dims.buildingHeightMm > 0) {
          onBuildingHeightChange?.(dims.buildingHeightMm);
        } else if (dims.estimatedBuildingHeightMm && dims.estimatedBuildingHeightMm > 0) {
          onBuildingHeightChange?.(dims.estimatedBuildingHeightMm);
        }
      }
    } catch {
      // Server extraction is best-effort; user can still trace manually
    } finally {
      setExtracting(false);
    }
  }, [onSegmentEdit, onBuildingHeightChange]);

  /* ═══════════════════════════════════════════════════════════
     CANVAS INTERACTION
     ═══════════════════════════════════════════════════════════ */

  const screenToCanvas = useCallback((cx: number, cy: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (cx - r.left - panX) / zoom, y: (cy - r.top - panY) / zoom };
  }, [panX, panY, zoom]);

  const findNear = useCallback((cx: number, cy: number): number | null => {
    const thr = 15 / zoom;
    for (let i = 0; i < points.length; i++) {
      if (ptDist(points[i], { x: cx, y: cy }) < thr) return i;
    }
    return null;
  }, [points, zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      if (points.length >= 3 && !closed) setClosed(true);
      return;
    }
    if (e.button !== 0) return;
    const c = screenToCanvas(e.clientX, e.clientY);

    // Calibration clicks
    if (calibPhase === 'point1') {
      setCalibPts([c]);
      setCalibPhase('point2');
      return;
    }
    if (calibPhase === 'point2') {
      setCalibPts(prev => [...prev, c]);
      setCalibPhase('input');
      return;
    }

    // Point dragging
    const near = findNear(c.x, c.y);
    if (near !== null) {
      setDraggingPt(near);
      isMouseDownRef.current = true;
      mouseMovedRef.current = false;
      return;
    }

    // Start pan tracking — only set the anchor, don't pan yet
    isMouseDownRef.current = true;
    isPanningRef.current = false;
    mouseMovedRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  }, [screenToCanvas, findNear, calibPhase, points.length, closed, panX, panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const c = screenToCanvas(e.clientX, e.clientY);

    // Point drag (only when mouse is down on a point)
    if (draggingPt !== null && isMouseDownRef.current) {
      mouseMovedRef.current = true;
      // Apply snap during drag too
      const lastPt = points.length > 1
        ? (draggingPt > 0 ? points[draggingPt - 1] : (closed ? points[points.length - 1] : null))
        : null;
      const snap = computeSnap(c, lastPt, points.filter((_, i) => i !== draggingPt), ALIGN_SNAP_PX / zoom, e.shiftKey);
      setCursorPos({ x: snap.x, y: snap.y });
      setSnapResult(snap);
      setPoints(prev => prev.map((p, i) =>
        i === draggingPt ? { ...p, x: snap.x, y: snap.y } : p,
      ));
      return;
    }

    // Pan — only when mouse button is held AND not dragging a point
    if (isMouseDownRef.current && draggingPt === null) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isPanningRef.current = true;
        mouseMovedRef.current = true;
      }
      if (isPanningRef.current) {
        setPanX(dragStartRef.current.px + dx);
        setPanY(dragStartRef.current.py + dy);
        setCursorPos(c);
        setSnapResult(null);
        return;
      }
    }

    // Normal move — compute snap for preview
    if (!closed) {
      const lastPt = points.length > 0 ? points[points.length - 1] : null;
      const snap = computeSnap(c, lastPt, points, ALIGN_SNAP_PX / zoom, e.shiftKey);
      setCursorPos({ x: snap.x, y: snap.y });
      setSnapResult(snap);
    } else {
      setCursorPos(c);
      setSnapResult(null);
    }

    // Hover detection (only when mouse is NOT down)
    if (!isMouseDownRef.current) {
      setHoveredPt(findNear(c.x, c.y));
    }
  }, [screenToCanvas, draggingPt, findNear, points, closed, zoom]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const wasDown = isMouseDownRef.current;
    isMouseDownRef.current = false;

    // Close inline segment editor when clicking on canvas
    if (editingSegIdx !== null) {
      setEditingSegIdx(null);
    }

    if (draggingPt !== null) {
      setDraggingPt(null);
      return;
    }
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    // If mouse wasn't pressed in this canvas, or it moved, ignore
    if (!wasDown || mouseMovedRef.current) return;
    if (e.button !== 0) return;
    if (calibPhase !== 'off') return;
    if (closed) return;

    const c = screenToCanvas(e.clientX, e.clientY);

    // Apply snap to the click position
    const lastPt = points.length > 0 ? points[points.length - 1] : null;
    const snap = computeSnap(c, lastPt, points, ALIGN_SNAP_PX / zoom, e.shiftKey);

    // Close if near first point (check both raw and snapped)
    if (points.length >= 3) {
      if (ptDist(points[0], { x: snap.x, y: snap.y }) < 15 / zoom ||
          ptDist(points[0], c) < 15 / zoom) {
        setClosed(true);
        return;
      }
    }

    // Add point at snapped position
    setPoints(prev => [...prev, { x: snap.x, y: snap.y, label: ptLabel(prev.length) }]);
  }, [screenToCanvas, closed, points, zoom, calibPhase, draggingPt, editingSegIdx]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nz = Math.max(0.005, Math.min(zoom * factor, 50));
    setPanX(mx - (mx - panX) * (nz / zoom));
    setPanY(my - (my - panY) * (nz / zoom));
    setZoom(nz);
  }, [zoom, panX, panY]);

  /* ═══════════════════════════════════════════════════════════
     CALIBRATION
     ═══════════════════════════════════════════════════════════ */

  const handleCalibConfirm = useCallback(() => {
    if (calibPts.length < 2) return;
    const realMm = parseFloat(calibInput);
    if (isNaN(realMm) || realMm <= 0) return;
    const pxd = ptDist(calibPts[0], calibPts[1]);
    if (pxd <= 0) return;
    setCalib({ mmPerPixel: realMm / pxd });
    setCalibPhase('off');
    setCalibPts([]);
    setCalibInput('');
  }, [calibPts, calibInput]);

  const handleCalibCancel = useCallback(() => {
    setCalibPhase('off');
    setCalibPts([]);
    setCalibInput('');
  }, []);

  /* ═══════════════════════════════════════════════════════════
     POLYGON ACTIONS
     ═══════════════════════════════════════════════════════════ */

  const handleUndo = useCallback(() => {
    if (closed) {
      setClosed(false);
    } else if (points.length > 0) {
      const idx = points.length - 2;
      setPoints(prev => prev.slice(0, -1));
      setManualDims(prev => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
    }
  }, [closed, points.length]);

  const handleClear = useCallback(() => {
    resetTracer();
    perimeterModel.clear();
  }, [resetTracer, perimeterModel]);

  /* ═══════════════════════════════════════════════════════════
     MEMOIZED RENDER DATA
     ═══════════════════════════════════════════════════════════ */

  // DXF background as a single SVG path (performant for large files)
  const dxfPathD = useMemo(() => {
    if (dxfDisplaySegs.length === 0) return '';
    return dxfDisplaySegs.map(s => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('');
  }, [dxfDisplaySegs]);

  // Preview SVG viewBox
  const previewVB = useMemo(() => {
    if (points.length < 2) return '0 0 100 100';
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (const p of points) {
      mnX = Math.min(mnX, p.x);
      mnY = Math.min(mnY, p.y);
      mxX = Math.max(mxX, p.x);
      mxY = Math.max(mxY, p.y);
    }
    const span = Math.max(mxX - mnX, mxY - mnY, 1);
    const pad = span * 0.2;
    return `${mnX - pad} ${mnY - pad} ${mxX - mnX + pad * 2} ${mxY - mnY + pad * 2}`;
  }, [points]);

  // Cursor style
  const cursor =
    draggingPt !== null ? 'grabbing'
    : calibPhase === 'point1' || calibPhase === 'point2' ? 'crosshair'
    : hoveredPt !== null ? 'grab'
    : closed ? 'default'
    : 'crosshair';

  // Dropzone
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    maxFiles: 1,
    multiple: false,
    noClick: phase === 'loaded',     // disable click-to-open when already loaded
    noKeyboard: phase === 'loaded',
  });

  /* ═══════════════════════════════════════════════════════════
     RENDER — UPLOAD PHASE
     ═══════════════════════════════════════════════════════════ */

  if (phase === 'upload') {
    return (
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
        style={{ height: 'calc(100vh - 10rem)', minHeight: 400 }}
      >
        <div
          className="h-full flex flex-col items-center justify-center p-8"
          {...getRootProps()}
        >
          <input {...getInputProps()} />
          {isLoading ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-14 w-14 animate-spin text-blue-500" />
              <span className="text-sm text-gray-500">{t('viewer', 'processingFile')}</span>
            </div>
          ) : (
            <div
              className={`w-full max-w-2xl border-2 border-dashed rounded-2xl p-16 text-center transition-all cursor-pointer
                ${isDragActive
                  ? 'border-blue-400 bg-blue-50 scale-[1.01]'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                }`}
            >
              <Upload className={`h-16 w-16 mx-auto mb-5 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
              <p className="text-xl font-semibold text-gray-700 mb-2">
                {t('viewer', 'dropDrawing')}
              </p>
              <p className="text-sm text-gray-500 mb-6">{t('viewer', 'dropOrClick')}</p>
              <div className="flex flex-wrap justify-center gap-2 text-xs">
                <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded-full border border-green-200 font-medium">
                  ✅ {t('viewer', 'dxfAutoDetect')}
                </span>
                <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                  📄 PDF
                </span>
                <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                  🖼 JPG / PNG
                </span>
                <span className="px-3 py-1.5 bg-red-50 text-red-600 rounded-full border border-red-200">
                  ❌ {t('viewer', 'dwgExportDxf')}
                </span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mt-6 flex items-start gap-2 text-sm text-red-600 bg-red-50 px-5 py-3 rounded-lg border border-red-200 max-w-xl">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{errorMsg}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — LOADED PHASE (SPLIT SCREEN)
     ═══════════════════════════════════════════════════════════ */

  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col"
      style={{ height: 'calc(100vh - 10rem)', minHeight: 400 }}
    >
      {/* ── Top toolbar ──────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0 flex-wrap">
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <FileUp className="h-3.5 w-3.5" /> {t('viewer', 'newFile')}
        </button>

        {fileMode === 'image' && !calib && calibPhase === 'off' && (
          <button
            onClick={() => { setCalibPhase('point1'); setCalibPts([]); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 text-amber-800"
          >
            <Ruler className="h-3.5 w-3.5" /> {t('viewer', 'calibrateScale')}
          </button>
        )}
        {calib && (
          <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
            <CheckCircle2 className="h-3 w-3" /> {t('viewer', 'scale')}: {calib.mmPerPixel.toFixed(2)} mm/px
          </span>
        )}

        <button
          onClick={handleUndo}
          disabled={points.length === 0 && !closed}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-30"
        >
          <RotateCcw className="h-3.5 w-3.5" /> {t('viewer', 'undo')}
        </button>
        <button
          onClick={handleClear}
          disabled={points.length === 0}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-red-50 text-red-600 disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" /> {t('viewer', 'clear')}
        </button>
        {!closed && points.length >= 3 && (
          <button
            onClick={() => setClosed(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('viewer', 'closePolygon')}
          </button>
        )}

        {/* Ortho indicator */}
        {!closed && (
          <span className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-all
            ${shiftHeld
              ? 'bg-amber-100 border-amber-400 text-amber-700 font-bold'
              : 'bg-gray-50 border-gray-200 text-gray-400'
            }`}
            title={t('viewer', 'orthoTooltip')}
          >
            ⊞ {shiftHeld ? t('viewer', 'orthoOn') : t('viewer', 'orthoOff')}
          </span>
        )}

        <button
          onClick={fitCanvas}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <Maximize2 className="h-3.5 w-3.5" /> {t('viewer', 'fit')}
        </button>
        <span className="text-xs text-gray-400 truncate max-w-[200px]">{fileName}</span>
      </div>

      {/* ── Calibration bars ─────────────────────────────── */}
      {calibPhase === 'input' && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
          <Ruler className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-800">{t('viewer', 'realDistance')}</span>
          <input
            type="number"
            value={calibInput}
            onChange={e => setCalibInput(e.target.value)}
            className="w-32 rounded border border-amber-300 px-2 py-1 text-sm"
            placeholder="mm"
            autoFocus
          />
          <span className="text-xs text-amber-600">mm</span>
          <button
            onClick={handleCalibConfirm}
            className="px-3 py-1 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700"
          >
            {t('viewer', 'apply')}
          </button>
          <button
            onClick={handleCalibCancel}
            className="px-3 py-1 text-xs bg-white border border-amber-300 rounded hover:bg-amber-50"
          >
            {t('viewer', 'cancel')}
          </button>
        </div>
      )}
      {(calibPhase === 'point1' || calibPhase === 'point2') && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200 flex-shrink-0">
          <Ruler className="h-3.5 w-3.5 text-amber-600" />
          <span className="text-xs text-amber-700">
            {calibPhase === 'point1'
              ? t('viewer', 'calibClickStart')
              : t('viewer', 'calibClickEnd')}
          </span>
          <button onClick={handleCalibCancel} className="ml-auto text-xs text-amber-600 hover:underline">
            {t('viewer', 'cancel')}
          </button>
        </div>
      )}

      {/* DXF auto-detected banner */}
      {fileMode === 'dxf' && closed && segments.length >= 3 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-green-50 border-b border-green-200 flex-shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          <span className="text-xs text-green-700 font-medium">
            {t('viewer', 'dxfAutoDetected')} — {segments.length} {t('viewer', 'segmentsCount')}, {(totalPerimeter / 1000).toFixed(2)}m {t('viewer', 'perimeterSuffix')}
          </span>
        </div>
      )}

      {/* Server extraction status */}
      {extracting && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 border-b border-blue-200 flex-shrink-0">
          <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />
          <span className="text-xs text-blue-700 font-medium">
            {t('viewer', 'extractingDims')}
          </span>
        </div>
      )}
      {!extracting && extractedDims && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-green-50 border-b border-green-200 flex-shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          <span className="text-xs text-green-700 font-medium">
            {t('viewer', 'extractionComplete')}
            {extractedDims.parsedDimensionsMm.length > 0 && ` — ${extractedDims.parsedDimensionsMm.length} ${t('viewer', 'segmentsCount')}`}
          </span>
        </div>
      )}

      {/* ── MAIN SPLIT ───────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ─── LEFT: Drawing Canvas ──────────────────────── */}
        <div
          ref={canvasRef}
          className="flex-1 relative overflow-hidden bg-gray-100 border-r border-gray-200"
          style={{ cursor }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setDraggingPt(null); isPanningRef.current = false; isMouseDownRef.current = false; }}
          onWheel={handleWheel}
          onContextMenu={e => e.preventDefault()}
        >
          {/* Transformed wrapper */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `translate(${panX}px,${panY}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Background image */}
            {fileMode === 'image' && imageUrl && (
              <img
                src={imageUrl}
                alt="Drawing"
                draggable={false}
                style={{ display: 'block', width: canvasW, height: canvasH }}
              />
            )}

            {/* SVG overlay (non-interactive — events handled by container) */}
            <svg
              style={{
                position: fileMode === 'image' ? 'absolute' : 'relative',
                top: 0,
                left: 0,
                width: canvasW,
                height: canvasH,
                pointerEvents: 'none',
              }}
              viewBox={`0 0 ${canvasW} ${canvasH}`}
            >
              {/* DXF white background */}
              {fileMode === 'dxf' && (
                <rect x={0} y={0} width={canvasW} height={canvasH} fill="white" />
              )}

              {/* DXF background lines */}
              {dxfPathD && (
                <path
                  d={dxfPathD}
                  stroke="#94a3b8"
                  strokeWidth={Math.max(0.5, 1 / zoom)}
                  fill="none"
                  opacity={0.5}
                />
              )}

              {/* Traced segments */}
              {segments.map((seg, i) => {
                const midX = (seg.from.x + seg.to.x) / 2;
                const midY = (seg.from.y + seg.to.y) / 2;
                // Offset the dimension text perpendicular to the segment
                const dx = seg.to.x - seg.from.x;
                const dy = seg.to.y - seg.from.y;
                const len = Math.hypot(dx, dy) || 1;
                const nx = -dy / len; // perpendicular normal
                const ny = dx / len;
                const offset = 14 / zoom;
                const txtX = midX + nx * offset;
                const txtY = midY + ny * offset;
                const dimText = seg.mm > 0 ? `${(seg.mm / 1000).toFixed(2)}m` : '?';
                return (
                  <g key={`seg-${i}`}>
                    <line
                      x1={seg.from.x}
                      y1={seg.from.y}
                      x2={seg.to.x}
                      y2={seg.to.y}
                      stroke="#2563eb"
                      strokeWidth={2.5 / zoom}
                      strokeLinecap="round"
                    />
                    {/* Dimension text along segment */}
                    {closed && (
                      <text
                        x={txtX}
                        y={txtY}
                        fill="#1e40af"
                        fontSize={10 / zoom}
                        fontWeight="600"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ userSelect: 'none' }}
                      >
                        {dimText}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* ── Snap guide lines ──────────────────────── */}
              {!closed && snapResult && snapResult.guides.map((g, i) => (
                <line
                  key={`guide-${i}`}
                  x1={g.x1} y1={g.y1}
                  x2={g.x2} y2={g.y2}
                  stroke={g.type === 'angle' ? '#f59e0b' : '#06b6d4'}
                  strokeWidth={0.8 / zoom}
                  strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                  opacity={0.7}
                />
              ))}

              {/* Cursor preview line (from last point to snapped cursor) */}
              {!closed && points.length > 0 && cursorPos && (
                <line
                  x1={points[points.length - 1].x}
                  y1={points[points.length - 1].y}
                  x2={cursorPos.x}
                  y2={cursorPos.y}
                  stroke={snapResult?.snappedOrtho ? '#f59e0b' : snapResult?.snappedAlign ? '#06b6d4' : '#94a3b8'}
                  strokeWidth={(snapResult?.snappedOrtho || snapResult?.snappedAlign ? 2 : 1.5) / zoom}
                  strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                />
              )}

              {/* ── Crosshair at cursor ──────────────────── */}
              {!closed && cursorPos && (
                <g opacity={0.4}>
                  <line
                    x1={cursorPos.x - 20 / zoom} y1={cursorPos.y}
                    x2={cursorPos.x + 20 / zoom} y2={cursorPos.y}
                    stroke={snapResult?.snappedOrtho || snapResult?.snappedAlign ? '#06b6d4' : '#64748b'}
                    strokeWidth={0.8 / zoom}
                  />
                  <line
                    x1={cursorPos.x} y1={cursorPos.y - 20 / zoom}
                    x2={cursorPos.x} y2={cursorPos.y + 20 / zoom}
                    stroke={snapResult?.snappedOrtho || snapResult?.snappedAlign ? '#06b6d4' : '#64748b'}
                    strokeWidth={0.8 / zoom}
                  />
                </g>
              )}

              {/* ── Distance + angle readout near cursor ── */}
              {!closed && cursorPos && snapResult && snapResult.distance != null && snapResult.distance > 5 && (
                <g>
                  <rect
                    x={cursorPos.x + 18 / zoom}
                    y={cursorPos.y + 8 / zoom}
                    width={120 / zoom}
                    height={calib || fileMode === 'dxf' ? 36 / zoom : 22 / zoom}
                    rx={4 / zoom}
                    fill="rgba(15,23,42,0.85)"
                  />
                  <text
                    x={cursorPos.x + 24 / zoom}
                    y={cursorPos.y + 22 / zoom}
                    fill="white"
                    fontSize={11 / zoom}
                    fontFamily="monospace"
                  >
                    {snapResult.angle != null ? `${Math.round(snapResult.angle)}° ` : ''}
                    {(calib || fileMode === 'dxf')
                      ? `${Math.round(
                          fileMode === 'dxf'
                            ? snapResult.distance
                            : snapResult.distance * (calib?.mmPerPixel ?? 1)
                        ).toLocaleString()} mm`
                      : `${Math.round(snapResult.distance)} px`}
                  </text>
                  {(calib || fileMode === 'dxf') && (
                    <text
                      x={cursorPos.x + 24 / zoom}
                      y={cursorPos.y + 36 / zoom}
                      fill="#94a3b8"
                      fontSize={9 / zoom}
                      fontFamily="monospace"
                    >
                      {(
                        (fileMode === 'dxf'
                          ? snapResult.distance
                          : snapResult.distance * (calib?.mmPerPixel ?? 1)) / 1000
                      ).toFixed(3)} m
                    </text>
                  )}
                </g>
              )}

              {/* ── Snap indicator (small diamond when snapped) ── */}
              {!closed && cursorPos && (snapResult?.snappedOrtho || snapResult?.snappedAlign) && (
                <g>
                  <polygon
                    points={[
                      `${cursorPos.x},${cursorPos.y - 6 / zoom}`,
                      `${cursorPos.x + 6 / zoom},${cursorPos.y}`,
                      `${cursorPos.x},${cursorPos.y + 6 / zoom}`,
                      `${cursorPos.x - 6 / zoom},${cursorPos.y}`,
                    ].join(' ')}
                    fill={snapResult.snappedOrtho ? '#f59e0b' : '#06b6d4'}
                    stroke="white"
                    strokeWidth={1 / zoom}
                    opacity={0.9}
                  />
                </g>
              )}

              {/* Close-snap indicator */}
              {!closed && points.length >= 3 && cursorPos &&
                ptDist(points[0], cursorPos) < 15 / zoom && (
                  <circle
                    cx={points[0].x}
                    cy={points[0].y}
                    r={14 / zoom}
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth={2 / zoom}
                    opacity={0.6}
                  />
                )}

              {/* Points */}
              {points.map((pt, i) => (
                <g key={`pt-${i}`}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={7 / zoom}
                    fill={i === 0 ? '#16a34a' : '#2563eb'}
                    stroke="white"
                    strokeWidth={2 / zoom}
                  />
                  <text
                    x={pt.x + 12 / zoom}
                    y={pt.y - 12 / zoom}
                    fill="#1e3a5f"
                    fontSize={13 / zoom}
                    fontWeight="bold"
                    style={{ userSelect: 'none' }}
                  >
                    {pt.label}
                  </text>
                </g>
              ))}

              {/* Calibration markers */}
              {calibPts.map((cp, i) => (
                <circle
                  key={`calib-${i}`}
                  cx={cp.x}
                  cy={cp.y}
                  r={8 / zoom}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth={2.5 / zoom}
                />
              ))}
              {calibPts.length === 2 && (
                <line
                  x1={calibPts[0].x}
                  y1={calibPts[0].y}
                  x2={calibPts[1].x}
                  y2={calibPts[1].y}
                  stroke="#dc2626"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${5 / zoom} ${3 / zoom}`}
                />
              )}
            </svg>
          </div>

          {/* ── Segment midpoint labels (clickable to edit) ── */}
          {segments.map((seg, i) => {
            const midX = (seg.from.x + seg.to.x) / 2;
            const midY = (seg.from.y + seg.to.y) / 2;
            // Convert canvas coords to screen coords
            const screenX = midX * zoom + panX;
            const screenY = midY * zoom + panY;
            const isEditing = editingSegIdx === i;
            return (
              <div
                key={`seg-label-${i}`}
                style={{
                  position: 'absolute',
                  left: screenX,
                  top: screenY,
                  transform: 'translate(-50%, -50%)',
                  zIndex: isEditing ? 50 : 20,
                  pointerEvents: 'auto',
                }}
              >
                {isEditing ? (
                  /* ── Inline edit popup ──────────────── */
                  <div
                    className="bg-white rounded-lg shadow-xl border-2 border-blue-500 p-2.5 flex flex-col gap-1.5 min-w-[180px]"
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onMouseUp={e => e.stopPropagation()}
                  >
                    <div className="text-[11px] font-bold text-blue-600">
                      {seg.fromLabel}→{seg.toLabel}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={editInputRef}
                        type="number"
                        value={editingSegVal}
                        onChange={e => setEditingSegVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = Number(editingSegVal) || 0;
                            if (val > 0) {
                              setManualDims(prev => ({ ...prev, [i]: val }));
                              onSegmentEdit?.(i, val);
                            }
                            setEditingSegIdx(null);
                          } else if (e.key === 'Escape') {
                            setEditingSegIdx(null);
                          }
                        }}
                        className="w-[90px] rounded border border-gray-300 px-2 py-1.5 text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="mm"
                        min={0}
                        step={100}
                        autoFocus
                      />
                      <span className="text-xs text-gray-500">mm</span>
                    </div>
                    {editingSegVal && Number(editingSegVal) > 0 && (
                      <div className="text-[10px] text-gray-400">
                        = {(Number(editingSegVal) / 1000).toFixed(2)} m
                      </div>
                    )}
                    <div className="flex gap-1.5 mt-0.5">
                      <button
                        onClick={() => {
                          const val = Number(editingSegVal) || 0;
                          if (val > 0) {
                            setManualDims(prev => ({ ...prev, [i]: val }));
                            onSegmentEdit?.(i, val);
                          }
                          setEditingSegIdx(null);
                        }}
                        className="flex-1 px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => setEditingSegIdx(null)}
                        className="flex-1 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 border border-gray-300"
                      >
                        {t('viewer', 'cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Clickable segment badge ───────── */
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setEditingSegIdx(i);
                      setEditingSegVal(seg.mm > 0 ? String(seg.mm) : '');
                    }}
                    onMouseDown={e => e.stopPropagation()}
                    onMouseUp={e => e.stopPropagation()}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm border transition-all
                      hover:scale-110 hover:shadow-md cursor-pointer
                      ${seg.confirmed && seg.mm > 0
                        ? 'bg-blue-600 text-white border-blue-700'
                        : 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse'
                      }`}
                    title={`Click to edit ${seg.fromLabel}→${seg.toLabel} length`}
                  >
                    {seg.fromLabel}{seg.toLabel}
                    {seg.mm > 0 ? ` ${(seg.mm / 1000).toFixed(1)}m` : ' ?'}
                  </button>
                )}
              </div>
            );
          })}

          {/* Empty-state instruction overlay */}
          {points.length === 0 && !closed && calibPhase === 'off' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-white/90 backdrop-blur-sm rounded-xl px-8 py-5 shadow-lg text-center max-w-sm">
                <p className="text-sm font-medium text-gray-700 mb-3">
                  {t('viewer', 'clickCorners')}
                </p>
                <div className="mt-3 space-y-1 text-xs text-gray-500">
                  <p>🧲 {t('viewer', 'autoSnap')}</p>
                  <p>⇧ {t('viewer', 'holdShift')}</p>
                  <p>🖱 {t('viewer', 'rightClick')}</p>
                </div>
                {fileMode === 'image' && !calib && (
                  <p className="text-xs text-amber-600 mt-3">
                    💡 {t('viewer', 'calibrateTip')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Preview & Controls ─────────────────── */}
        <div className="w-[380px] flex-shrink-0 flex flex-col bg-white border-l border-gray-200">

          {/* ── Header with stats + Fit ────────────────────── */}
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
            <span className="text-xs text-gray-500">
              {t('viewer', 'points')}: <b className="text-gray-700">{points.length}</b>
            </span>
            <span className="text-xs text-gray-500">
              {t('viewer', 'segments')}: <b className="text-gray-700">{segments.length}</b>
            </span>
            {closed && <span className="text-xs text-green-600 font-semibold">● {t('viewer', 'closed')}</span>}
            {!closed && points.length > 0 && <span className="text-xs text-amber-500">○ {t('viewer', 'open')}</span>}
            <button
              onClick={fitCanvas}
              className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              <Maximize2 className="h-3 w-3" /> {t('viewer', 'fit')}
            </button>
          </div>

          {/* ── Scrollable content ─────────────────────────── */}
          <div className="flex-1 overflow-y-auto">

            {/* Polygon preview SVG */}
            <div className="p-3 border-b border-gray-100">
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-2" style={{ height: 160 }}>
                {points.length >= 2 ? (
                  <svg width="100%" height="100%" viewBox={previewVB} preserveAspectRatio="xMidYMid meet">
                    {closed && points.length >= 3 && (
                      <polygon
                        points={points.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="#dbeafe"
                        stroke="none"
                        opacity={0.4}
                      />
                    )}
                    {segments.map((seg, i) => {
                      const span = Math.max(...points.map(p => p.x), 1) - Math.min(...points.map(p => p.x));
                      const sw = Math.max(span, 1) * 0.008;
                      return (
                        <line
                          key={i}
                          x1={seg.from.x} y1={seg.from.y}
                          x2={seg.to.x} y2={seg.to.y}
                          stroke={seg.confirmed ? '#2563eb' : '#94a3b8'}
                          strokeWidth={sw}
                          strokeLinecap="round"
                        />
                      );
                    })}
                    {points.map((pt, i) => {
                      const span = Math.max(...points.map(p => p.x), 1) - Math.min(...points.map(p => p.x));
                      const r = Math.max(span, 1) * 0.015;
                      const fs = Math.max(span, 1) * 0.035;
                      return (
                        <g key={i}>
                          <circle cx={pt.x} cy={pt.y} r={r} fill={i === 0 ? '#16a34a' : '#2563eb'} />
                          <text x={pt.x} y={pt.y - r * 2} textAnchor="middle"
                            fill="#1e3a5f" fontSize={fs} fontWeight="bold">{pt.label}</text>
                        </g>
                      );
                    })}
                  </svg>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">
                    {t('viewer', 'clickAtLeast2')}
                  </div>
                )}
              </div>
            </div>

            {/* ── SEGMENTS — All editable ─────────────────── */}
            {segments.length > 0 && (
              <div className="px-3 py-3 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {t('viewer', 'segmentsHeader')}
                </h3>
                <div className="space-y-1">
                  {segments.map((seg, i) => (
                    <div key={i} className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1.5 border border-gray-200">
                      {/* Label */}
                      <span className="text-[11px] font-mono font-bold text-blue-600 w-10 flex-shrink-0">
                        {seg.fromLabel}→{seg.toLabel}
                      </span>
                      {/* mm input — always editable */}
                      <input
                        type="number"
                        value={seg.mm || ''}
                        onChange={e => {
                          const val = Number(e.target.value) || 0;
                          setManualDims(prev => ({ ...prev, [i]: val }));
                          onSegmentEdit?.(i, val);
                        }}
                        placeholder="mm"
                        className="w-[80px] rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-right
                                   focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        min={0}
                        step={100}
                      />
                      <span className="text-[10px] text-gray-400 w-6">mm</span>
                      {/* m display (auto-calculated) */}
                      <span className="text-[11px] text-gray-500 w-14 text-right tabular-nums">
                        {seg.mm > 0 ? `${(seg.mm / 1000).toFixed(2)}m` : '—'}
                      </span>
                      {/* Status icon */}
                      {seg.confirmed ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-amber-400 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div className="mt-2 pt-2 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-xs text-gray-500">{t('viewer', 'totalPerimeter')}</span>
                  <div className="text-right">
                    <span className="text-sm font-bold text-blue-600">
                      {totalPerimeter > 0 ? `${totalPerimeter.toLocaleString()} mm` : '—'}
                    </span>
                    {totalPerimeter > 0 && (
                      <span className="text-xs text-gray-400 ml-1.5">
                        ({(totalPerimeter / 1000).toFixed(2)} m)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Building Height — show as soon as polygon is closed ── */}
            {closed && (
              <div className="px-3 py-3 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {t('viewer', 'buildingHeight')}
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={buildingHeightMm || ''}
                    onChange={e => onBuildingHeightChange?.(Number(e.target.value) || null)}
                    placeholder="mm"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    min={1000}
                    step={100}
                  />
                  <span className="text-xs text-gray-400">mm</span>
                  <span className="text-xs text-gray-500 w-16 text-right">
                    {buildingHeightMm ? `${(buildingHeightMm / 1000).toFixed(1)}m` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { label: '1F', value: 3900 },
                    { label: '2F', value: 6900 },
                    { label: '3F', value: 9900 },
                    { label: '4F', value: 12900 },
                    { label: '5F', value: 15900 },
                  ].map(p => (
                    <button
                      key={p.label}
                      onClick={() => onBuildingHeightChange?.(p.value)}
                      className={`px-2.5 py-1 text-xs rounded border transition-colors
                        ${buildingHeightMm === p.value
                          ? 'bg-blue-100 border-blue-400 text-blue-700 font-semibold'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-blue-50'
                        }`}
                    >
                      {p.label} ({(p.value / 1000).toFixed(1)}m)
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Ready summary */}
            {allConfirmed && buildingHeightMm && buildingHeightMm > 0 && (
              <div className="px-3 py-3 bg-green-50 border-b border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-800">{t('viewer', 'readyToCalc')}</span>
                </div>
                <div className="text-xs text-green-700 space-y-0.5">
                  <p>{t('viewer', 'perimeterLabel')}: {(totalPerimeter / 1000).toFixed(2)} m ({segments.length} {t('viewer', 'walls')})</p>
                  <p>{t('viewer', 'heightLabel')}: {(buildingHeightMm / 1000).toFixed(1)} m</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Bottom guidance ─────────────────────────────── */}
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-400 flex-shrink-0">
            {closed
              ? t('viewer', 'guideClosed')
              : points.length === 0
                ? t('viewer', 'guideStart')
                : points.length < 3
                  ? `${ptLabel(points.length)}${t('viewer', 'guideNeedMore')}${3 - points.length}${t('viewer', 'guideNeedMoreSuffix')}`
                  : `${ptLabel(points.length)}${t('viewer', 'guideCloseHint')}`}
          </div>
        </div>
      </div>
    </div>
  );
}
