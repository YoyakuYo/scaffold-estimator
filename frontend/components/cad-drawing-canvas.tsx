'use client';

import { useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { type TranslationKeys } from '@/lib/i18n/translations';
import {
  MousePointer2,
  PenTool,
  Square,
  Undo2,
  Trash2,
  Check,
  Grid3X3,
  Ruler,
  RotateCcw,
  Move,
  Building2,
} from 'lucide-react';
import {
  SCAFFOLD_WALL_CF_KEYS,
  normalizeScaffoldWallCfKey,
  type ScaffoldWallCfKey,
} from '@/lib/scaffold-wall-cf-options';
import {
  EDGE_HASHIRA_STATION_SELECT_MAX,
  formRowsFromWallCount,
  type EdgeHashiraFormRow,
} from '@/lib/edge-hashira-labels';
import { inferEdgePlanAxisFromVertices } from '@/lib/infer-edge-plan-axis';
import { PreviewZoomToolbar } from '@/components/scaffold/preview-zoom-toolbar';
import { mToMm, mmToM } from '@/lib/dimension-meters';

// ─── Types ──────────────────────────────────────────────────

export interface CadPoint {
  x: number;
  y: number;
}

export interface CadWall {
  start: CadPoint;
  end: CadPoint;
  lengthMm: number;
}

export interface CadDrawingResult {
  vertices: Array<{ xFrac: number; yFrac: number }>;
  walls: Array<{
    side: string;
    wallLengthMm: number;
    wallHeightMm: number;
    stairAccessCount: number;
    cfNote?: string;
    edgePlanAxis?: 'X' | 'Y';
    edgePlanAxisMm?: number;
  }>;
  buildingHeightMm: number;
  closed: boolean;
  edgeHashiraRows?: EdgeHashiraFormRow[];
}

const SCAFFOLD_WALL_CF_LABEL_KEYS = {
  reflex: 'wallCfReflex',
  c: 'wallCfC',
} as const satisfies Record<ScaffoldWallCfKey, keyof TranslationKeys['scaffoldExtra']>;

const HASHIRA_STATION_OPTIONS = Array.from(
  { length: EDGE_HASHIRA_STATION_SELECT_MAX },
  (_, i) => i + 1,
);

function parseMetersInputToMm(s: string): number | null {
  const v = parseFloat(String(s).trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  return mToMm(v);
}

type Tool = 'select' | 'polyline' | 'rectangle' | 'pan';

interface Props {
  buildingHeightMm: number;
  onBuildingHeightChange: (h: number) => void;
  onComplete: (result: CadDrawingResult) => void;
  /** Live footprint in mm (same convention as export vertices) for parent 2D preview while drawing. */
  onLiveFootprintMmChange?: (
    verticesMm: Array<{ x: number; y: number }> | null,
    isClosed: boolean,
  ) => void;
  initialVertices?: CadPoint[];
  /** Calibration: known real-world distance for a reference segment */
  calibrationMmPerPixel?: number;
  className?: string;
}

const GRID_SPACING = 50;
const SNAP_RADIUS = 15;
const POINT_RADIUS = 6;
const CLOSE_THRESHOLD = 20;

export function CadDrawingCanvas({
  buildingHeightMm,
  onBuildingHeightChange,
  onComplete,
  onLiveFootprintMmChange,
  initialVertices,
  className = '',
}: Props) {
  const { t } = useI18n();
  const mUnit = t('common', 'metersShort') || 'm';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('polyline');
  const [points, setPoints] = useState<CadPoint[]>(initialVertices ?? []);
  const [mousePos, setMousePos] = useState<CadPoint | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<CadPoint>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<CadPoint | null>(null);
  const spaceDownRef = useRef(false);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });
  const [wallHeightsMmLocal, setWallHeightsMmLocal] = useState<number[]>([]);
  const [wallCfLocal, setWallCfLocal] = useState<ScaffoldWallCfKey[]>([]);
  const [edgePlanAxesLocal, setEdgePlanAxesLocal] = useState<Array<'X' | 'Y'>>([]);
  const [edgePlanAxisMmLocal, setEdgePlanAxisMmLocal] = useState<number[]>([]);
  const [hashiraRowsLocal, setHashiraRowsLocal] = useState<EdgeHashiraFormRow[]>([]);

  // Calibration state
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<CadPoint[]>([]);
  const [calibrationMm, setCalibrationMm] = useState<number | null>(null);
  const [mmPerPixel, setMmPerPixel] = useState(100); // default: 100mm per grid unit

  const pointsRef = useRef(points);
  const mmPerPixelRef = useRef(mmPerPixel);
  pointsRef.current = points;
  mmPerPixelRef.current = mmPerPixel;

  // Dimension editing
  const [editingEdge, setEditingEdge] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cw = Math.max(320, Math.min(920, el.clientWidth - 8));
      const ch = Math.round(cw * (600 / 900));
      setCanvasSize((prev) => (prev.w === cw && prev.h === ch ? prev : { w: cw, h: ch }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) e.preventDefault();
      if (e.code === 'Space') spaceDownRef.current = true;
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  const canvasWidth = canvasSize.w;
  const canvasHeight = canvasSize.h;

  const edgeCountForDims = useMemo(() => {
    if (points.length < 2) return 0;
    return isClosed ? points.length : points.length - 1;
  }, [points.length, isClosed]);

  const vertsMm = useMemo(
    () =>
      points.map((p) => ({
        x: Math.round(p.x * mmPerPixel),
        y: Math.round(p.y * mmPerPixel),
      })),
    [points, mmPerPixel],
  );

  useEffect(() => {
    const n = edgeCountForDims;
    setWallHeightsMmLocal((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(buildingHeightMm);
      return next;
    });
    setWallCfLocal((prev) => {
      const next = prev.slice(0, n).map((v) => normalizeScaffoldWallCfKey(v));
      while (next.length < n) next.push('reflex');
      return next;
    });
    setHashiraRowsLocal((prev) => formRowsFromWallCount(prev, n));
  }, [edgeCountForDims, buildingHeightMm]);

  useEffect(() => {
    const n = edgeCountForDims;
    if (n === 0) {
      setEdgePlanAxesLocal([]);
      setEdgePlanAxisMmLocal([]);
      return;
    }
    const vm = pointsRef.current.map((p) => ({
      x: Math.round(p.x * mmPerPixelRef.current),
      y: Math.round(p.y * mmPerPixelRef.current),
    }));
    setEdgePlanAxesLocal((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) {
        const i = next.length;
        const inf = inferEdgePlanAxisFromVertices(vm, i, isClosed);
        next.push(inf?.axis ?? 'X');
      }
      return next;
    });
    setEdgePlanAxisMmLocal((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) {
        const i = next.length;
        const inf = inferEdgePlanAxisFromVertices(vm, i, isClosed);
        next.push(inf?.mm ?? 0);
      }
      return next;
    });
  }, [edgeCountForDims, isClosed]);

  const snapPoint = useCallback(
    (p: CadPoint): CadPoint => {
      if (!snapToGrid) return p;
      const gs = GRID_SPACING * zoom;
      return {
        x: Math.round((p.x - pan.x) / gs) * gs + pan.x,
        y: Math.round((p.y - pan.y) / gs) * gs + pan.y,
      };
    },
    [snapToGrid, zoom, pan],
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number): CadPoint => ({
      x: (sx - pan.x) / zoom,
      y: (sy - pan.y) / zoom,
    }),
    [zoom, pan],
  );

  const worldToScreen = useCallback(
    (wx: number, wy: number): CadPoint => ({
      x: wx * zoom + pan.x,
      y: wy * zoom + pan.y,
    }),
    [zoom, pan],
  );

  const distPixels = (a: CadPoint, b: CadPoint) =>
    Math.hypot(b.x - a.x, b.y - a.y);

  const edgeLengthMm = useCallback(
    (a: CadPoint, b: CadPoint) => {
      const px = distPixels(a, b);
      return Math.round(px * mmPerPixel);
    },
    [mmPerPixel],
  );

  // Draw the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(100, 100, 140, 0.3)';
      ctx.lineWidth = 0.5;
      const gs = GRID_SPACING * zoom;
      const startX = (pan.x % gs + gs) % gs;
      const startY = (pan.y % gs + gs) % gs;
      for (let x = startX; x < canvasWidth; x += gs) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
      }
      for (let y = startY; y < canvasHeight; y += gs) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
      }

      // Origin crosshair
      const ox = worldToScreen(0, 0);
      ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox.x, 0);
      ctx.lineTo(ox.x, canvasHeight);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(100, 255, 100, 0.4)';
      ctx.beginPath();
      ctx.moveTo(0, ox.y);
      ctx.lineTo(canvasWidth, ox.y);
      ctx.stroke();
    }

    // Calibration line
    if (calibrationMode && calibrationPoints.length > 0) {
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      const sp = worldToScreen(calibrationPoints[0].x, calibrationPoints[0].y);
      ctx.moveTo(sp.x, sp.y);
      if (calibrationPoints.length === 2) {
        const ep = worldToScreen(calibrationPoints[1].x, calibrationPoints[1].y);
        ctx.lineTo(ep.x, ep.y);
      } else if (mousePos) {
        ctx.lineTo(mousePos.x, mousePos.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw edges
    if (points.length >= 2) {
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sp0 = worldToScreen(points[0].x, points[0].y);
      ctx.moveTo(sp0.x, sp0.y);
      for (let i = 1; i < points.length; i++) {
        const sp = worldToScreen(points[i].x, points[i].y);
        ctx.lineTo(sp.x, sp.y);
      }
      if (isClosed) {
        ctx.lineTo(sp0.x, sp0.y);
      }
      ctx.stroke();

      // Fill polygon if closed
      if (isClosed && points.length >= 3) {
        ctx.fillStyle = 'rgba(79, 195, 247, 0.1)';
        ctx.beginPath();
        ctx.moveTo(sp0.x, sp0.y);
        for (let i = 1; i < points.length; i++) {
          const sp = worldToScreen(points[i].x, points[i].y);
          ctx.lineTo(sp.x, sp.y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw rubber-band line from last point to cursor
    if (!isClosed && points.length > 0 && mousePos && tool === 'polyline') {
      const lastPt = worldToScreen(points[points.length - 1].x, points[points.length - 1].y);
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lastPt.x, lastPt.y);
      ctx.lineTo(mousePos.x, mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Show distance to cursor
      const worldMouse = screenToWorld(mousePos.x, mousePos.y);
      const len = edgeLengthMm(points[points.length - 1], worldMouse);
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      const midX = (lastPt.x + mousePos.x) / 2;
      const midY = (lastPt.y + mousePos.y) / 2;
      ctx.fillText(`${mmToM(len).toFixed(3)}m`, midX + 5, midY - 5);
    }

    // Draw dimension labels on edges
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      if (!isClosed && j === 0 && i === points.length - 1) continue;
      if (j >= points.length && !isClosed) continue;

      const sp1 = worldToScreen(points[i].x, points[i].y);
      const sp2 = worldToScreen(points[j].x, points[j].y);
      const len = edgeLengthMm(points[i], points[j]);
      const midX = (sp1.x + sp2.x) / 2;
      const midY = (sp1.y + sp2.y) / 2;

      const dx = sp2.x - sp1.x;
      const dy = sp2.y - sp1.y;
      const angle = Math.atan2(dy, dx);
      const offsetX = -Math.sin(angle) * 16;
      const offsetY = Math.cos(angle) * 16;

      ctx.fillStyle = editingEdge === i ? '#ffd700' : '#e0e0e0';
      ctx.font = editingEdge === i ? 'bold 13px monospace' : '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${(len / 1000).toFixed(3)}m`,
        midX + offsetX,
        midY + offsetY,
      );
    }

    // Draw points
    points.forEach((p, i) => {
      const sp = worldToScreen(p.x, p.y);
      ctx.fillStyle = i === 0 ? '#4caf50' : '#4fc3f7';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Vertex label
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String.fromCharCode(65 + (i % 26)), sp.x, sp.y - 10);
    });

    // Close indicator
    if (!isClosed && points.length >= 3 && mousePos) {
      const firstPtScreen = worldToScreen(points[0].x, points[0].y);
      if (distPixels(mousePos, firstPtScreen) < CLOSE_THRESHOLD) {
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(firstPtScreen.x, firstPtScreen.y, CLOSE_THRESHOLD, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Cursor crosshair
    if (mousePos && (tool === 'polyline' || tool === 'rectangle')) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mousePos.x, 0);
      ctx.lineTo(mousePos.x, canvasHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, mousePos.y);
      ctx.lineTo(canvasWidth, mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Coordinate display
      const wp = screenToWorld(mousePos.x, mousePos.y);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `(${mmToM(Math.round(wp.x * mmPerPixel)).toFixed(3)}m, ${mmToM(Math.round(wp.y * mmPerPixel)).toFixed(3)}m)`,
        mousePos.x + 10,
        mousePos.y - 10,
      );
    }
  }, [
    points,
    mousePos,
    isClosed,
    showGrid,
    zoom,
    pan,
    tool,
    mmPerPixel,
    editingEdge,
    calibrationMode,
    calibrationPoints,
    worldToScreen,
    screenToWorld,
    edgeLengthMm,
  ]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (spaceDownRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (calibrationMode) {
        const wp = screenToWorld(sx, sy);
        if (calibrationPoints.length < 2) {
          setCalibrationPoints((prev) => [...prev, wp]);
        }
        return;
      }

      if (tool === 'pan') return;
      if (isClosed) return;

      const worldPt = screenToWorld(sx, sy);
      const snapped = snapToGrid
        ? {
            x: Math.round(worldPt.x / GRID_SPACING) * GRID_SPACING,
            y: Math.round(worldPt.y / GRID_SPACING) * GRID_SPACING,
          }
        : worldPt;

      if (tool === 'polyline') {
        // Check if clicking near first point to close
        if (points.length >= 3) {
          const firstScreen = worldToScreen(points[0].x, points[0].y);
          if (distPixels({ x: sx, y: sy }, firstScreen) < CLOSE_THRESHOLD) {
            setIsClosed(true);
            return;
          }
        }
        setPoints((prev) => [...prev, snapped]);
      }

      if (tool === 'rectangle') {
        if (points.length === 0) {
          setPoints([snapped]);
        } else if (points.length === 1) {
          const p0 = points[0];
          const rectPts: CadPoint[] = [
            p0,
            { x: snapped.x, y: p0.y },
            snapped,
            { x: p0.x, y: snapped.y },
          ];
          setPoints(rectPts);
          setIsClosed(true);
        }
      }
    },
    [
      tool,
      points,
      isClosed,
      snapToGrid,
      calibrationMode,
      calibrationPoints,
      screenToWorld,
      worldToScreen,
    ],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setMousePos({ x: sx, y: sy });

      if (isPanning && panStart) {
        const dx = sx - panStart.x;
        const dy = sy - panStart.y;
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        setPanStart({ x: sx, y: sy });
      }
    },
    [isPanning, panStart],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const panActive =
        tool === 'pan' || e.button === 1 || e.button === 2 || (e.button === 0 && spaceDownRef.current);
      if (panActive) {
        if (e.button === 2) e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        setIsPanning(true);
        setPanStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    },
    [tool],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.max(0.2, Math.min(5, prev * delta)));
  }, []);

  const handleUndo = useCallback(() => {
    if (isClosed) {
      setIsClosed(false);
    } else {
      setPoints((prev) => prev.slice(0, -1));
    }
  }, [isClosed]);

  const handleClear = useCallback(() => {
    setPoints([]);
    setIsClosed(false);
    setEditingEdge(null);
  }, []);

  const handleCalibrate = useCallback(() => {
    setCalibrationMode(true);
    setCalibrationPoints([]);
    setCalibrationMm(null);
  }, []);

  const applyCalibration = useCallback(() => {
    if (calibrationPoints.length !== 2 || !calibrationMm || calibrationMm <= 0) return;
    const px = distPixels(calibrationPoints[0], calibrationPoints[1]);
    if (px < 1) return;
    setMmPerPixel(calibrationMm / px);
    setCalibrationMode(false);
    setCalibrationPoints([]);
  }, [calibrationPoints, calibrationMm]);

  const handleEdgeClick = useCallback(
    (edgeIndex: number) => {
      setEditingEdge(edgeIndex);
      const lenMm = edgeLengthMm(points[edgeIndex], points[(edgeIndex + 1) % points.length]);
      setEditValue(String(Math.round(mmToM(lenMm) * 10000) / 10000));
    },
    [points, edgeLengthMm],
  );

  const applyEdgeLength = useCallback(() => {
    if (editingEdge === null) return;
    const newLenM = parseFloat(editValue);
    if (isNaN(newLenM) || newLenM < 0.6) return;
    const newLen = mToMm(newLenM);

    const i = editingEdge;
    const j = (i + 1) % points.length;
    const a = points[i];
    const b = points[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const currentPx = Math.hypot(dx, dy);
    if (currentPx < 0.001) return;

    const targetPx = newLen / mmPerPixel;
    const scale = targetPx / currentPx;
    const newB: CadPoint = {
      x: a.x + dx * scale,
      y: a.y + dy * scale,
    };

    setPoints((prev) => {
      const next = [...prev];
      next[j] = newB;
      return next;
    });
    setEditingEdge(null);
  }, [editingEdge, editValue, points, mmPerPixel]);

  const handleComplete = useCallback(() => {
    if (!isClosed || points.length < 3) return;

    const walls = points.map((p, i) => {
      const j = (i + 1) % points.length;
      const len = edgeLengthMm(p, points[j]);
      return {
        side: `edge-${i}`,
        wallLengthMm: Math.max(600, len),
        wallHeightMm: wallHeightsMmLocal[i] ?? buildingHeightMm,
        stairAccessCount: 0,
        cfNote: wallCfLocal[i] ?? 'reflex',
        edgePlanAxis: edgePlanAxesLocal[i],
        edgePlanAxisMm: edgePlanAxisMmLocal[i],
      };
    });

    const vertices = points.map((p) => ({
      xFrac: Math.round(p.x * mmPerPixel),
      yFrac: Math.round(p.y * mmPerPixel),
    }));

    onComplete({
      vertices,
      walls,
      buildingHeightMm,
      closed: true,
      edgeHashiraRows:
        hashiraRowsLocal.length === walls.length ? hashiraRowsLocal : undefined,
    });
  }, [
    points,
    isClosed,
    buildingHeightMm,
    mmPerPixel,
    edgeLengthMm,
    onComplete,
    wallHeightsMmLocal,
    wallCfLocal,
    edgePlanAxesLocal,
    edgePlanAxisMmLocal,
    hashiraRowsLocal,
  ]);

  const edgeList = useMemo(() => {
    if (points.length < 2) return [];
    const edges: { index: number; label: string; lengthMm: number }[] = [];
    const count = isClosed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % points.length;
      edges.push({
        index: i,
        label: `${String.fromCharCode(65 + (i % 26))}→${String.fromCharCode(65 + (j % 26))}`,
        lengthMm: edgeLengthMm(points[i], points[j]),
      });
    }
    return edges;
  }, [points, isClosed, edgeLengthMm]);

  useEffect(() => {
    if (!onLiveFootprintMmChange) return;
    try {
      if (points.length < 2) {
        onLiveFootprintMmChange(null, false);
        return;
      }
      const verts = points.map((p) => ({
        x: Math.round(p.x * mmPerPixel),
        y: Math.round(p.y * mmPerPixel),
      }));
      onLiveFootprintMmChange(verts, isClosed);
    } catch {
      onLiveFootprintMmChange(null, false);
    }
  }, [points, mmPerPixel, isClosed, onLiveFootprintMmChange]);

  const cadPerimeterMm = useMemo(
    () => edgeList.reduce((s, e) => s + e.lengthMm, 0),
    [edgeList],
  );

  return (
    <div className={`flex flex-col ${className}`}>
      {calibrationMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-3 mb-3">
          <Ruler className="h-5 w-5 text-amber-600 flex-shrink-0" />
          {calibrationPoints.length < 2 ? (
            <span className="text-sm text-amber-800">
              {t('viewer', 'cadCalibLineHint')}（{calibrationPoints.length}/2）
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-800">{t('viewer', 'cadRealDimension')}</span>
              <input
                type="number"
                value={calibrationMm != null && calibrationMm > 0 ? Math.round(mmToM(calibrationMm) * 100000) / 100000 : ''}
                onChange={(e) => {
                  const m = parseFloat(e.target.value);
                  setCalibrationMm(Number.isFinite(m) && m > 0 ? mToMm(m) : null);
                }}
                placeholder={mUnit}
                min={0.001}
                step={0.001}
                className="w-28 px-2 py-1 rounded border border-amber-300 text-sm"
                autoFocus
              />
              <span className="text-xs text-amber-600">{mUnit}</span>
              <button
                onClick={applyCalibration}
                disabled={!calibrationMm || calibrationMm <= 0}
                className="px-3 py-1 rounded bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                {t('viewer', 'apply')}
              </button>
              <button
                onClick={() => { setCalibrationMode(false); setCalibrationPoints([]); }}
                className="px-2 py-1 rounded border border-amber-300 text-amber-700 text-sm hover:bg-amber-100"
              >
                {t('viewer', 'cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col lg:flex-row border border-gray-200 rounded-xl overflow-hidden bg-white" style={{ minHeight: 520 }}>
        <div className="flex-1 flex flex-col relative bg-gray-100 min-h-[400px]">
          <div className="flex flex-wrap items-center gap-2 p-2 border-b border-gray-200 bg-white shrink-0">
            <div className="flex gap-1 border-r border-gray-200 pr-2">
              {([
                { id: 'select' as Tool, icon: MousePointer2, labelKey: 'cadToolSelect' as const },
                { id: 'polyline' as Tool, icon: PenTool, labelKey: 'cadToolPolyline' as const },
                { id: 'rectangle' as Tool, icon: Square, labelKey: 'cadToolRectangle' as const },
                { id: 'pan' as Tool, icon: Move, labelKey: 'cadToolPan' as const },
              ]).map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => setTool(tb.id)}
                  className={`p-2 rounded ${tool === tb.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  title={t('viewer', tb.labelKey)}
                >
                  <tb.icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <div className="flex gap-1 border-r border-gray-200 pr-2">
              <button type="button" onClick={handleUndo} className="p-2 rounded text-gray-600 hover:bg-gray-100" title={t('viewer', 'undo')}>
                <Undo2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={handleClear} className="p-2 rounded text-gray-600 hover:bg-gray-100" title={t('viewer', 'clear')}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-1 border-r border-gray-200 pr-2">
              <button
                type="button"
                onClick={() => setShowGrid(!showGrid)}
                className={`p-2 rounded ${showGrid ? 'bg-gray-200 text-gray-900' : 'text-gray-600 hover:bg-gray-100'}`}
                title={t('viewer', 'cadGrid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSnapToGrid(!snapToGrid)}
                className={`px-2 py-1 rounded text-xs font-mono ${snapToGrid ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                title={t('viewer', 'cadSnap')}
              >
                SNAP
              </button>
            </div>
            <button
              type="button"
              onClick={handleCalibrate}
              className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium border ${
                calibrationMode ? 'bg-red-600 text-white border-red-600' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Ruler className="h-3.5 w-3.5" />
              {t('viewer', 'cadReferenceDim')}
            </button>
            {isClosed && (
              <button
                type="button"
                onClick={handleComplete}
                className="ml-auto flex items-center gap-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
              >
                <Check className="h-4 w-4" />
                {t('viewer', 'cadConfirmDrawing')}
              </button>
            )}
          </div>

          <div className="relative flex-1 p-3 flex flex-col min-h-0">
            <div className="absolute top-5 right-5 z-10">
              <PreviewZoomToolbar
                onZoomIn={() => setZoom((z) => Math.min(5, z * 1.15))}
                onZoomOut={() => setZoom((z) => Math.max(0.2, z / 1.15))}
                onReset={() => { setZoom(1); setPan({ x: 100, y: 100 }); }}
              />
            </div>
            <div ref={containerRef} className="flex-1 flex items-center justify-center min-h-[280px]">
              <canvas
                ref={canvasRef}
                width={canvasWidth}
                height={canvasHeight}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                onContextMenu={(e) => e.preventDefault()}
                className="rounded-lg border border-gray-300 cursor-crosshair bg-[#1a1a2e] max-w-full"
                style={{ width: canvasWidth, height: canvasHeight }}
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-2 px-1">{t('scaffoldExtra', 'cadPanHint')}</p>
            <div className="flex items-center justify-between mt-1 text-xs text-gray-500 px-1">
              <span>
                {tool === 'polyline' && !isClosed
                  ? points.length === 0
                    ? t('viewer', 'cadHintPolylineFirst')
                    : points.length >= 3
                      ? t('viewer', 'cadHintPolylineClose')
                      : t('viewer', 'cadHintPolylineNext')
                  : tool === 'rectangle' && !isClosed
                    ? points.length === 0
                      ? t('viewer', 'cadHintRectCorner')
                      : t('viewer', 'cadHintRectDiagonal')
                    : isClosed
                      ? t('viewer', 'cadHintClosedConfirm')
                      : ''}
              </span>
              <span>
                {t('viewer', 'cadCanvasScaleHint')
                  .replace('{z}', String(Math.round(zoom * 100)))
                  .replace('{v}', mmToM(mmPerPixel).toFixed(4))}
              </span>
            </div>
          </div>
        </div>

        <div className="w-full lg:w-96 flex flex-col border-t lg:border-t-0 lg:border-l border-gray-200 bg-white max-h-[90vh] lg:max-h-none">
          <div className="p-4 border-b border-gray-200 shrink-0">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Building2 className="h-4 w-4 text-blue-600" />
              {t('viewer', 'buildingHeight')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={0.01}
                value={buildingHeightMm >= 1000 ? Math.round((buildingHeightMm / 1000) * 1000) / 1000 : ''}
                onChange={(e) => {
                  const mm = parseMetersInputToMm(e.target.value);
                  if (mm != null) onBuildingHeightChange(Math.max(1000, mm));
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500 w-8">{mUnit}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Ruler className="h-4 w-4 text-blue-600" />
                {t('scaffoldExtra', 'wallDimensions') || 'Wall dimensions'}
              </h3>
              {cadPerimeterMm > 0 && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  {(t('viewer', 'perimeterLabel') || 'Perimeter')}: {(cadPerimeterMm / 1000).toFixed(2)}{mUnit}
                </span>
              )}
            </div>

            {edgeList.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{t('scaffoldExtra', 'cadDimsEmptyHint')}</p>
            ) : (
              <div className="space-y-1.5">
                {edgeList.map((edge) => {
                  const i = edge.index;
                  const lA = String.fromCharCode(65 + (i % 26));
                  const jv = (i + 1) % points.length;
                  const lB = String.fromCharCode(65 + (jv % 26));
                  const len = edge.lengthMm;
                  const hMm = wallHeightsMmLocal[i] ?? buildingHeightMm;
                  const planAxis = edgePlanAxesLocal[i] ?? 'X';
                  const planAxisMm = edgePlanAxisMmLocal[i] ?? 0;
                  const v0 = vertsMm[i];
                  const v1 = vertsMm[jv];
                  const dxM = v0 && v1 ? (v1.x - v0.x) / 1000 : null;
                  const dyM = v0 && v1 ? (v1.y - v0.y) / 1000 : null;
                  const hr = hashiraRowsLocal[i] ?? { axis: '' as const, countStr: '' };
                  const hashiraAxis = hr.axis === 'X' || hr.axis === 'Y' ? hr.axis : null;
                  const effectiveAxis: 'X' | 'Y' = hashiraAxis ?? planAxis;
                  const rawStation = hr.countStr.trim();
                  const stationParsed = rawStation === '' ? Number.NaN : parseInt(rawStation, 10);
                  const stationEnd =
                    Number.isFinite(stationParsed) && stationParsed > 0
                      ? Math.min(500, Math.floor(stationParsed))
                      : null;
                  const fieldBox = 'rounded-md border border-gray-200 bg-white/90 p-1.5 shadow-sm';
                  return (
                    <div
                      key={i}
                      className={`rounded-lg border px-2 py-2 transition-colors ${
                        editingEdge === i
                          ? 'bg-blue-50 ring-2 ring-blue-300 border-blue-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="text-[11px] font-bold text-blue-800">
                          {lA}→{lB}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        <div className={fieldBox}>
                          <span className="text-[10px] text-gray-500 block mb-0.5">L ({mUnit})</span>
                          {editingEdge === i ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && applyEdgeLength()}
                                className="w-full px-1.5 py-0.5 border border-blue-300 rounded text-[11px] font-mono"
                                autoFocus
                                min={0.6}
                                step={0.001}
                              />
                              <button type="button" onClick={applyEdgeLength} className="text-green-600 shrink-0">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleEdgeClick(i)}
                              className="w-full text-left px-1.5 py-0.5 text-[11px] font-mono text-gray-800 hover:bg-gray-50 rounded"
                            >
                              {(len / 1000).toFixed(3)}
                            </button>
                          )}
                        </div>
                        <div className={fieldBox}>
                          <span className="text-[10px] text-gray-500 block mb-0.5">H ({mUnit})</span>
                          <input
                            type="number"
                            min={1}
                            step={0.01}
                            value={hMm >= 1000 ? Math.round((hMm / 1000) * 1000) / 1000 : ''}
                            onChange={(e) => {
                              const mm = parseMetersInputToMm(e.target.value);
                              if (mm != null && mm >= 1000) {
                                setWallHeightsMmLocal((prev) => {
                                  const n = [...prev];
                                  n[i] = mm;
                                  return n;
                                });
                              }
                            }}
                            className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px] font-mono"
                          />
                        </div>
                        <div className={fieldBox}>
                          <span className="text-[10px] text-gray-500 block mb-0.5">
                            {t('scaffoldExtra', 'edgeXYRun') || 'XY'}
                          </span>
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <select
                              value={effectiveAxis}
                              onChange={(e) => {
                                const axis = e.target.value as 'X' | 'Y';
                                const mmAxis =
                                  axis === 'X' && dxM != null
                                    ? Math.round(dxM * 1000)
                                    : axis === 'Y' && dyM != null
                                      ? Math.round(dyM * 1000)
                                      : planAxisMm;
                                setEdgePlanAxesLocal((prev) => {
                                  const n = [...prev];
                                  n[i] = axis;
                                  return n;
                                });
                                setEdgePlanAxisMmLocal((prev) => {
                                  const n = [...prev];
                                  n[i] = mmAxis;
                                  return n;
                                });
                                setHashiraRowsLocal((prev) => {
                                  const n = [...prev];
                                  const cur = n[i] ?? { axis: '' as const, countStr: '' };
                                  n[i] = { ...cur, axis };
                                  return n;
                                });
                              }}
                              className="w-11 shrink-0 rounded border border-gray-200 px-1 py-0.5 text-[11px] font-semibold bg-gray-50"
                            >
                              <option value="X">X</option>
                              <option value="Y">Y</option>
                            </select>
                            <select
                              value={stationEnd != null ? String(stationEnd) : ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                setHashiraRowsLocal((prev) => {
                                  const n = [...prev];
                                  const cur = n[i] ?? { axis: '' as const, countStr: '' };
                                  n[i] = { ...cur, axis: effectiveAxis, countStr: v === '' ? '' : v };
                                  return n;
                                });
                              }}
                              title={(t('scaffoldExtra', 'edgePlanStationEndHint') as string) || ''}
                              className="min-w-[3.25rem] shrink-0 rounded border border-gray-200 px-1 py-0.5 text-[11px] font-mono bg-white"
                            >
                              <option value="">{t('scaffoldExtra', 'edgePlanStationEnd') || 'To #'}</option>
                              {HASHIRA_STATION_OPTIONS.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          {stationEnd != null ? (
                            <p className="text-[10px] font-mono text-blue-900 mt-0.5 font-semibold">
                              {`${effectiveAxis}1\u2013${effectiveAxis}${stationEnd}`}
                            </p>
                          ) : null}
                          {dxM != null && dyM != null ? (
                            <p className="text-[9px] text-gray-400 mt-0.5 font-mono truncate" title="Δ">
                              ΔX {dxM.toFixed(2)} · ΔY {dyM.toFixed(2)} {mUnit}
                            </p>
                          ) : null}
                        </div>
                        <div className={fieldBox}>
                          <span className="text-[10px] text-gray-500 block mb-0.5">CF</span>
                          <select
                            value={normalizeScaffoldWallCfKey(wallCfLocal[i])}
                            onChange={(e) => {
                              const v = normalizeScaffoldWallCfKey(e.target.value);
                              setWallCfLocal((prev) => {
                                const n = [...prev];
                                n[i] = v;
                                return n;
                              });
                            }}
                            className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px] bg-white"
                          >
                            {SCAFFOLD_WALL_CF_KEYS.map((cfKey) => (
                              <option key={cfKey} value={cfKey}>
                                {t('scaffoldExtra', SCAFFOLD_WALL_CF_LABEL_KEYS[cfKey]) || cfKey}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
