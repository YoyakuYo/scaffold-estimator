'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
  ZoomIn,
  ZoomOut,
  Move,
} from 'lucide-react';

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
  walls: Array<{ side: string; wallLengthMm: number; wallHeightMm: number; stairAccessCount: number }>;
  buildingHeightMm: number;
  closed: boolean;
}

type Tool = 'select' | 'polyline' | 'rectangle' | 'pan';

interface Props {
  buildingHeightMm: number;
  onBuildingHeightChange: (h: number) => void;
  onComplete: (result: CadDrawingResult) => void;
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
  initialVertices,
  className = '',
}: Props) {
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

  // Calibration state
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<CadPoint[]>([]);
  const [calibrationMm, setCalibrationMm] = useState<number | null>(null);
  const [mmPerPixel, setMmPerPixel] = useState(100); // default: 100mm per grid unit

  // Dimension editing
  const [editingEdge, setEditingEdge] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const canvasWidth = 900;
  const canvasHeight = 600;

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
      ctx.fillText(`${len}mm`, midX + 5, midY - 5);
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
        `(${Math.round(wp.x * mmPerPixel)}mm, ${Math.round(wp.y * mmPerPixel)}mm)`,
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
      if (tool === 'pan' || e.button === 1) {
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
      setEditValue(String(edgeLengthMm(points[edgeIndex], points[(edgeIndex + 1) % points.length])));
    },
    [points, edgeLengthMm],
  );

  const applyEdgeLength = useCallback(() => {
    if (editingEdge === null) return;
    const newLen = parseFloat(editValue);
    if (isNaN(newLen) || newLen < 600) return;

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
        wallHeightMm: buildingHeightMm,
        stairAccessCount: 0,
      };
    });

    const vertices = points.map((p) => ({
      xFrac: Math.round(p.x * mmPerPixel),
      yFrac: Math.round(p.y * mmPerPixel),
    }));

    onComplete({ vertices, walls, buildingHeightMm, closed: true });
  }, [points, isClosed, buildingHeightMm, mmPerPixel, edgeLengthMm, onComplete]);

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

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 bg-gray-800 rounded-lg p-2">
        <div className="flex gap-1 border-r border-gray-600 pr-2">
          {([
            { id: 'select' as Tool, icon: MousePointer2, label: '選択' },
            { id: 'polyline' as Tool, icon: PenTool, label: 'ポリライン' },
            { id: 'rectangle' as Tool, icon: Square, label: '矩形' },
            { id: 'pan' as Tool, icon: Move, label: 'パン' },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`p-2 rounded ${tool === t.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
              title={t.label}
            >
              <t.icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        <div className="flex gap-1 border-r border-gray-600 pr-2">
          <button onClick={handleUndo} className="p-2 rounded text-gray-300 hover:bg-gray-700" title="元に戻す">
            <Undo2 className="h-4 w-4" />
          </button>
          <button onClick={handleClear} className="p-2 rounded text-gray-300 hover:bg-gray-700" title="クリア">
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={() => setZoom((z) => Math.min(5, z * 1.2))} className="p-2 rounded text-gray-300 hover:bg-gray-700" title="ズームイン">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))} className="p-2 rounded text-gray-300 hover:bg-gray-700" title="ズームアウト">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 100, y: 100 }); }} className="p-2 rounded text-gray-300 hover:bg-gray-700" title="リセット">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-r border-gray-600 pr-2">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-2 rounded ${showGrid ? 'bg-gray-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
            title="グリッド"
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSnapToGrid(!snapToGrid)}
            className={`px-2 py-1 rounded text-xs font-mono ${snapToGrid ? 'bg-green-700 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
            title="スナップ"
          >
            SNAP
          </button>
        </div>

        <button
          onClick={handleCalibrate}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium ${
            calibrationMode ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-gray-700 border border-gray-600'
          }`}
        >
          <Ruler className="h-3.5 w-3.5" />
          基準寸法
        </button>

        {isClosed && (
          <button
            onClick={handleComplete}
            className="ml-auto flex items-center gap-1 px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
          >
            <Check className="h-4 w-4" />
            図面確定
          </button>
        )}
      </div>

      {/* Calibration dialog */}
      {calibrationMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-3">
          <Ruler className="h-5 w-5 text-amber-600 flex-shrink-0" />
          {calibrationPoints.length < 2 ? (
            <span className="text-sm text-amber-800">
              基準線の始点と終点をクリックしてください（{calibrationPoints.length}/2）
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-800">実寸法:</span>
              <input
                type="number"
                value={calibrationMm ?? ''}
                onChange={(e) => setCalibrationMm(Number(e.target.value) || null)}
                placeholder="mm"
                className="w-28 px-2 py-1 rounded border border-amber-300 text-sm"
                autoFocus
              />
              <span className="text-xs text-amber-600">mm</span>
              <button
                onClick={applyCalibration}
                disabled={!calibrationMm || calibrationMm <= 0}
                className="px-3 py-1 rounded bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                適用
              </button>
              <button
                onClick={() => { setCalibrationMode(false); setCalibrationPoints([]); }}
                className="px-2 py-1 rounded border border-amber-300 text-amber-700 text-sm hover:bg-amber-100"
              >
                キャンセル
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        {/* Canvas */}
        <div ref={containerRef} className="flex-1">
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
            className="rounded-lg border border-gray-700 cursor-crosshair w-full"
            style={{ aspectRatio: `${canvasWidth}/${canvasHeight}` }}
          />
          <div className="flex items-center justify-between mt-1 text-xs text-gray-500 px-1">
            <span>
              {tool === 'polyline' && !isClosed
                ? points.length === 0
                  ? 'クリックして最初の頂点を配置'
                  : points.length >= 3
                    ? '最初の頂点をクリックして閉じる'
                    : '次の頂点をクリック'
                : tool === 'rectangle' && !isClosed
                  ? points.length === 0
                    ? '矩形の角をクリック'
                    : '対角をクリック'
                  : isClosed
                    ? '「図面確定」をクリックして確定'
                    : ''}
            </span>
            <span>ズーム: {Math.round(zoom * 100)}% | 1px = {mmPerPixel.toFixed(1)}mm</span>
          </div>
        </div>

        {/* Edge dimension list */}
        <div className="w-52 bg-gray-800 rounded-lg p-3 text-white overflow-y-auto max-h-[660px]">
          <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase">寸法一覧</h4>
          <div className="mb-3">
            <label className="text-xs text-gray-400 block mb-1">建物の高さ</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={buildingHeightMm}
                onChange={(e) => onBuildingHeightChange(Math.max(1000, Number(e.target.value) || 3000))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm font-mono text-white"
                min={1000}
                step={100}
              />
              <span className="text-xs text-gray-500">mm</span>
            </div>
          </div>
          {edgeList.length > 0 && (
            <div className="space-y-1">
              {edgeList.map((edge) => (
                <div
                  key={edge.index}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    editingEdge === edge.index ? 'bg-blue-700' : 'hover:bg-gray-700'
                  }`}
                  onClick={() => handleEdgeClick(edge.index)}
                >
                  <span className="text-xs font-medium text-gray-400 w-10">{edge.label}</span>
                  {editingEdge === edge.index ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && applyEdgeLength()}
                        className="w-20 bg-gray-600 border border-blue-400 rounded px-1 py-0.5 text-xs font-mono text-white"
                        autoFocus
                        min={600}
                      />
                      <button onClick={applyEdgeLength} className="text-green-400 hover:text-green-300">
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-mono text-gray-200">
                      {(edge.lengthMm / 1000).toFixed(3)}m
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {edgeList.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-600">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">周長</span>
                <span className="font-mono text-gray-200">
                  {(edgeList.reduce((s, e) => s + e.lengthMm, 0) / 1000).toFixed(3)}m
                </span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-gray-400">頂点数</span>
                <span className="font-mono text-gray-200">{points.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
