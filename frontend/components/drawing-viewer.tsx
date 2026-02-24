'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Image as ImageIcon, PenTool, Undo2, Trash2, Check } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface TracedPoint {
  /** Fraction of image width (0-1) */
  xFrac: number;
  /** Fraction of image height (0-1) */
  yFrac: number;
}

interface DrawingViewerProps {
  imageUrl: string | null;
  fileName?: string | null;
  resolution?: { width: number; height: number } | null;
  /** Callback when user finishes tracing building outline */
  onOutlineTraced?: (points: TracedPoint[]) => void;
  /** Current traced outline (for display) */
  tracedOutline?: TracedPoint[] | null;
}

export function DrawingViewer({ imageUrl, fileName, resolution, onOutlineTraced, tracedOutline }: DrawingViewerProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });

  // Trace mode state
  const [traceMode, setTraceMode] = useState(false);
  const [tracePoints, setTracePoints] = useState<TracedPoint[]>([]);

  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setImgLoaded(false);
    setImgError(false);
    setTraceMode(false);
    setTracePoints([]);
  }, [imageUrl]);

  // Sync external outline into trace points for editing
  useEffect(() => {
    if (tracedOutline && tracedOutline.length > 0 && tracePoints.length === 0 && !traceMode) {
      setTracePoints(tracedOutline);
    }
  }, [tracedOutline]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (traceMode) return; // no zoom in trace mode
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.1, Math.min(10, s * delta)));
  }, [traceMode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (traceMode) return;
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - translate.x, y: e.clientY - translate.y });
  }, [translate, traceMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (traceMode) return;
    if (!isDragging) return;
    setTranslate({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [isDragging, dragStart, traceMode]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const fitToView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // Click on image to add trace point
  const handleTraceClick = useCallback((e: React.MouseEvent) => {
    if (!traceMode || !imgRef.current) return;
    e.stopPropagation();

    const imgEl = imgRef.current;
    const rect = imgEl.getBoundingClientRect();
    const xFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yFrac = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setTracePoints(prev => [...prev, { xFrac, yFrac }]);
  }, [traceMode]);

  const handleTraceUndo = useCallback(() => {
    setTracePoints(prev => prev.slice(0, -1));
  }, []);

  const handleTraceClear = useCallback(() => {
    setTracePoints([]);
  }, []);

  const handleTraceFinish = useCallback(() => {
    if (tracePoints.length >= 3) {
      onOutlineTraced?.(tracePoints);
    }
    setTraceMode(false);
  }, [tracePoints, onOutlineTraced]);

  const handleTraceCancel = useCallback(() => {
    setTracePoints(tracedOutline ?? []);
    setTraceMode(false);
  }, [tracedOutline]);

  const startTraceMode = useCallback(() => {
    // Reset zoom/pan for tracing
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setTracePoints(tracedOutline ?? []);
    setTraceMode(true);
  }, [tracedOutline]);

  const handleImgLoad = useCallback(() => {
    setImgLoaded(true);
    if (imgRef.current) {
      setImgNaturalSize({
        w: imgRef.current.naturalWidth,
        h: imgRef.current.naturalHeight,
      });
    }
  }, []);

  if (!imageUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 p-8">
        <ImageIcon className="h-16 w-16 text-gray-300 mb-3" />
        <p className="text-sm text-gray-400 text-center">図面をアップロードするとここに表示されます</p>
        <p className="text-xs text-gray-300 mt-1">Drawing will appear here after upload</p>
      </div>
    );
  }

  // Build SVG overlay for traced points
  const displayPoints = traceMode ? tracePoints : (tracedOutline ?? []);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
        <div className="flex items-center gap-1 text-xs text-gray-500 truncate max-w-[45%]">
          <ImageIcon className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{fileName || 'Drawing'}</span>
          {resolution && (
            <span className="text-gray-400 flex-shrink-0">({resolution.width}×{resolution.height})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {traceMode ? (
            /* Trace mode toolbar */
            <>
              <button onClick={handleTraceUndo} disabled={tracePoints.length === 0}
                className="p-1 rounded hover:bg-gray-200 transition-colors disabled:opacity-30" title="Undo last point">
                <Undo2 className="h-3.5 w-3.5 text-gray-600" />
              </button>
              <button onClick={handleTraceClear} disabled={tracePoints.length === 0}
                className="p-1 rounded hover:bg-gray-200 transition-colors disabled:opacity-30" title="Clear all">
                <Trash2 className="h-3.5 w-3.5 text-gray-600" />
              </button>
              <button onClick={handleTraceFinish} disabled={tracePoints.length < 3}
                className="px-2 py-0.5 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-40" title="Finish">
                <Check className="h-3 w-3 inline mr-0.5" />完了
              </button>
              <button onClick={handleTraceCancel}
                className="px-2 py-0.5 rounded bg-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-300 transition-colors">
                取消
              </button>
              <span className="text-xs text-orange-600 font-medium ml-1">
                {tracePoints.length}点
              </span>
            </>
          ) : (
            /* Normal toolbar */
            <>
              <button onClick={startTraceMode}
                className={`p-1 rounded transition-colors ${displayPoints.length > 0 ? 'bg-orange-100 hover:bg-orange-200' : 'hover:bg-gray-200'}`}
                title={t('viewer', 'traceOutline')}>
                <PenTool className={`h-3.5 w-3.5 ${displayPoints.length > 0 ? 'text-orange-600' : 'text-gray-600'}`} />
              </button>
              <button onClick={() => setScale((s) => Math.min(s * 1.25, 10))}
                className="p-1 rounded hover:bg-gray-200 transition-colors" title="Zoom In">
                <ZoomIn className="h-3.5 w-3.5 text-gray-600" />
              </button>
              <button onClick={() => setScale((s) => Math.max(s / 1.25, 0.1))}
                className="p-1 rounded hover:bg-gray-200 transition-colors" title="Zoom Out">
                <ZoomOut className="h-3.5 w-3.5 text-gray-600" />
              </button>
              <button onClick={fitToView}
                className="p-1 rounded hover:bg-gray-200 transition-colors" title="Fit to View">
                <Maximize2 className="h-3.5 w-3.5 text-gray-600" />
              </button>
              <span className="text-xs text-gray-400 ml-1 w-10 text-right">{Math.round(scale * 100)}%</span>
            </>
          )}
        </div>
      </div>

      {/* Trace mode instruction banner */}
      {traceMode && (
        <div className="px-3 py-1.5 bg-orange-50 border-b border-orange-200 text-xs text-orange-700">
          🖱️ {t('viewer', 'traceHint')}
        </div>
      )}

      {/* Image Canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-gray-100 rounded-b-lg relative"
        style={{
          cursor: traceMode ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
          minHeight: 200,
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {imgError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <RotateCcw className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">画像の読み込みに失敗しました</p>
              <p className="text-xs">Failed to load image</p>
            </div>
          </div>
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: traceMode ? 'none' : `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
          >
            {/* Image */}
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageUrl}
                alt={fileName || 'Uploaded drawing'}
                className="max-w-full max-h-full object-contain select-none"
                draggable={false}
                onLoad={handleImgLoad}
                onError={() => setImgError(true)}
                style={{
                  display: imgLoaded ? 'block' : 'none',
                  pointerEvents: traceMode ? 'auto' : 'none',
                }}
                onClick={handleTraceClick}
              />

              {/* Polygon overlay on the image */}
              {imgLoaded && displayPoints.length > 0 && imgRef.current && (
                <svg
                  className="absolute top-0 left-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgRef.current.clientWidth} ${imgRef.current.clientHeight}`}
                  style={{ width: imgRef.current.clientWidth, height: imgRef.current.clientHeight }}
                >
                  {/* Polygon fill */}
                  {displayPoints.length >= 3 && (
                    <polygon
                      points={displayPoints.map(p => `${p.xFrac * imgRef.current!.clientWidth},${p.yFrac * imgRef.current!.clientHeight}`).join(' ')}
                      fill="rgba(59,130,246,0.08)"
                      stroke="#2563eb"
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  )}
                  {/* Lines connecting points */}
                  {displayPoints.length >= 2 && displayPoints.length < 3 && (
                    <polyline
                      points={displayPoints.map(p => `${p.xFrac * imgRef.current!.clientWidth},${p.yFrac * imgRef.current!.clientHeight}`).join(' ')}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth={2}
                    />
                  )}
                  {/* Corner dots */}
                  {displayPoints.map((p, i) => (
                    <g key={i}>
                      <circle
                        cx={p.xFrac * imgRef.current!.clientWidth}
                        cy={p.yFrac * imgRef.current!.clientHeight}
                        r={5}
                        fill={i === 0 ? '#22c55e' : '#2563eb'}
                        stroke="white"
                        strokeWidth={2}
                      />
                      <text
                        x={p.xFrac * imgRef.current!.clientWidth + 8}
                        y={p.yFrac * imgRef.current!.clientHeight - 6}
                        fontSize={10}
                        fontWeight="bold"
                        fill="#1e293b"
                        stroke="white"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {i + 1}
                      </text>
                    </g>
                  ))}
                </svg>
              )}

              {!imgLoaded && (
                <div className="text-gray-400 text-sm animate-pulse">
                  読み込み中... / Loading...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
