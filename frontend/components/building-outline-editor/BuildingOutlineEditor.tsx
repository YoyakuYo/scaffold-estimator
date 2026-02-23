'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Point, Segment } from '@/lib/geometry/types';
import { snapToAxis, snapPointToAxis } from '@/lib/geometry/snapToAxis';
import { calculateEndpoint, metersToPixels, pixelsToMeters, distance } from '@/lib/geometry/calculateEndpoint';
import { recalculateChain } from '@/lib/geometry/recalculateChain';
import { CanvasLayer } from './CanvasLayer';
import { LengthInputOverlay } from './LengthInputOverlay';
import { calculateKusabi, KusabiCalculationResult } from '@/scaffolding';

/** Accepted MIME types for the reference file upload */
const ACCEPTED_FILE_TYPES: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
  'image/svg+xml': ['.svg'],
  'image/tiff': ['.tif', '.tiff'],
  'application/pdf': ['.pdf'],
};

/** Max file size: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Render the first page of a PDF blob to an image-URL (data: or blob:).
 * Uses pdfjs-dist (dynamic import) with a hosted worker.
 */
async function renderPdfToImageUrl(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const pdfjsAny = pdfjs as any;

  if (pdfjsAny.GlobalWorkerOptions && !pdfjsAny.GlobalWorkerOptions.workerSrc) {
    pdfjsAny.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsAny.version}/build/pdf.worker.min.mjs`;
  }

  const data = await file.arrayBuffer();
  const loadingTask = pdfjsAny.getDocument({ data });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  await pdf.destroy();

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('PDF render produced empty blob'));
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}

export interface BuildingOutlineEditorProps {
  /** Callback when outline data changes */
  onOutlineChange?: (points: Point[], segments: Segment[]) => void;
  /** Initial points (optional) */
  initialPoints?: Point[];
  /** Initial segments (optional) */
  initialSegments?: Segment[];
  /** Scale factor: pixels per meter (default: 100) */
  pixelsPerMeter?: number;
}

export function BuildingOutlineEditor({
  onOutlineChange,
  initialPoints = [],
  initialSegments = [],
  pixelsPerMeter = 100,
}: BuildingOutlineEditorProps) {
  // State
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [currentPreviewPoint, setCurrentPreviewPoint] = useState<Point | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [isShapeClosed, setIsShapeClosed] = useState(false);
  
  // Length input overlay state
  const [showLengthInput, setShowLengthInput] = useState(false);
  const [lengthInputPosition, setLengthInputPosition] = useState<Point>({ x: 0, y: 0 });
  const [lengthInputSegmentIndex, setLengthInputSegmentIndex] = useState<number | null>(null);
  const [pendingLength, setPendingLength] = useState<number>(0);

  // Scaffold height state
  const [scaffoldHeight, setScaffoldHeight] = useState<string>('');

  // Reference file state (images + PDF)
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  // Track blob URLs so we can revoke them to avoid memory leaks
  const blobUrlRef = useRef<string | null>(null);

  // Canvas dimensions
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [canvasHeight, setCanvasHeight] = useState(600);

  // Update canvas size on mount and resize
  useEffect(() => {
    const updateCanvasSize = () => {
      if (canvasContainerRef.current) {
        const rect = canvasContainerRef.current.getBoundingClientRect();
        // Account for padding
        setCanvasWidth(Math.max(800, rect.width - 32));
        setCanvasHeight(Math.max(600, rect.height - 32));
      }
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    if (canvasContainerRef.current) {
      resizeObserver.observe(canvasContainerRef.current);
    }
    
    window.addEventListener('resize', updateCanvasSize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  // Notify parent of changes
  useEffect(() => {
    if (onOutlineChange) {
      onOutlineChange(points, segments);
    }
  }, [points, segments, onOutlineChange]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Process an accepted file (image or PDF)
  const processFile = useCallback(async (file: File) => {
    // Revoke previous blob URL if any
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setImageError(null);
    setImageLoading(true);
    setImageFileName(file.name);

    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        // Render first page of PDF to an image
        const url = await renderPdfToImageUrl(file);
        blobUrlRef.current = url;
        setImageUrl(url);
      } else {
        // Standard image — read as data URL
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });
        setImageUrl(url);
      }
    } catch (err) {
      console.error('File load error:', err);
      setImageError(err instanceof Error ? err.message : 'Failed to load file');
      setImageUrl(null);
      setImageFileName(null);
    } finally {
      setImageLoading(false);
    }
  }, []);

  // Remove current reference file
  const removeFile = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setImageUrl(null);
    setImageFileName(null);
    setImageError(null);
  }, []);

  // Dropzone setup
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) processFile(file);
  }, [processFile]);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
  } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
    onDropRejected: (rejections) => {
      const msg = rejections[0]?.errors[0]?.message || 'File not accepted';
      setImageError(msg);
    },
  });

  // Handle canvas click
  const handleCanvasClick = useCallback((point: Point) => {
    if (isShapeClosed) return;

    if (points.length === 0) {
      // First point
      setPoints([point]);
    } else {
      // Add new point and create segment
      const lastPoint = points[points.length - 1];
      const axis = snapToAxis(lastPoint, point);
      const initialLength = distance(lastPoint, point);
      const initialLengthMeters = pixelsToMeters(initialLength, pixelsPerMeter);

      // Show length input overlay
      const midpoint = {
        x: (lastPoint.x + point.x) / 2,
        y: (lastPoint.y + point.y) / 2,
      };
      setLengthInputPosition(midpoint);
      setPendingLength(initialLengthMeters);
      setLengthInputSegmentIndex(segments.length); // New segment index
      setShowLengthInput(true);
    }
  }, [points, segments.length, isShapeClosed, pixelsPerMeter]);

  // Handle length input confirmation
  const handleLengthConfirm = useCallback((length: number) => {
    if (lengthInputSegmentIndex === null) return;

    setShowLengthInput(false);

    if (lengthInputSegmentIndex === segments.length) {
      // Creating new segment
      const lastPoint = points[points.length - 1];
      const previewPoint = currentPreviewPoint || lastPoint;
      const axis = snapToAxis(lastPoint, previewPoint);
      const lengthInPixels = metersToPixels(length, pixelsPerMeter);
      const newEnd = calculateEndpoint(lastPoint, axis, lengthInPixels);

      // Determine direction based on preview point
      if (axis === 'horizontal') {
        const direction = previewPoint.x > lastPoint.x ? 1 : -1;
        const correctedEnd = {
          x: lastPoint.x + direction * lengthInPixels,
          y: lastPoint.y,
        };
        setPoints([...points, correctedEnd]);
        setSegments([
          ...segments,
          {
            start: lastPoint,
            end: correctedEnd,
            length,
          },
        ]);
      } else {
        const direction = previewPoint.y > lastPoint.y ? 1 : -1;
        const correctedEnd = {
          x: lastPoint.x,
          y: lastPoint.y + direction * lengthInPixels,
        };
        setPoints([...points, correctedEnd]);
        setSegments([
          ...segments,
          {
            start: lastPoint,
            end: correctedEnd,
            length,
          },
        ]);
      }
    } else {
      // Editing existing segment
      const result = recalculateChain(segments, lengthInputSegmentIndex, length, pixelsPerMeter);
      setSegments(result.segments);
      setPoints(result.points);
    }

    setLengthInputSegmentIndex(null);
    setActiveSegmentIndex(null);
  }, [points, segments, currentPreviewPoint, lengthInputSegmentIndex, pixelsPerMeter]);

  // Handle length input cancel
  const handleLengthCancel = useCallback(() => {
    setShowLengthInput(false);
    setLengthInputSegmentIndex(null);
    setActiveSegmentIndex(null);
    isClosingShapeRef.current = false;
  }, []);

  // Handle mouse move (preview)
  const handleMouseMove = useCallback((point: Point) => {
    if (isShapeClosed || points.length === 0) {
      setCurrentPreviewPoint(null);
      return;
    }

    setCurrentPreviewPoint(point);
  }, [points, isShapeClosed]);

  // Handle segment click (for editing)
  const handleSegmentClick = useCallback((index: number) => {
    if (isShapeClosed) return;

    const segment = segments[index];
    const midpoint = {
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
    };

    setActiveSegmentIndex(index);
    setLengthInputPosition(midpoint);
    setPendingLength(segment.length);
    setLengthInputSegmentIndex(index);
    setShowLengthInput(true);
  }, [segments, isShapeClosed]);

  // Calculate perimeter
  const getPerimeter = useCallback((): number => {
    return segments.reduce((sum, segment) => sum + segment.length, 0);
  }, [segments]);

  // Get wall lengths (one per segment)
  const getWallLengths = useCallback((): Array<{ index: number; length: number }> => {
    return segments.map((segment, index) => ({
      index: index + 1,
      length: segment.length,
    }));
  }, [segments]);

  // Kusabi scaffold calculation — runs when shape is closed AND height is entered
  const kusabiResult: KusabiCalculationResult | null = useMemo(() => {
    const heightNum = parseFloat(scaffoldHeight);
    if (!isShapeClosed || segments.length < 3 || isNaN(heightNum) || heightNum <= 0) {
      return null;
    }
    try {
      return calculateKusabi({ segments, height: heightNum });
    } catch {
      return null;
    }
  }, [isShapeClosed, segments, scaffoldHeight]);

  // Track if we're closing the shape
  const isClosingShapeRef = useRef(false);

  // Close shape
  const handleCloseShape = useCallback(() => {
    if (points.length < 3 || isShapeClosed) return;

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    const axis = snapToAxis(lastPoint, firstPoint);
    const initialLength = distance(lastPoint, firstPoint);
    const initialLengthMeters = pixelsToMeters(initialLength, pixelsPerMeter);

    // Mark that we're closing the shape
    isClosingShapeRef.current = true;

    // Show length input for closing segment
    const midpoint = {
      x: (lastPoint.x + firstPoint.x) / 2,
      y: (lastPoint.y + firstPoint.y) / 2,
    };
    setLengthInputPosition(midpoint);
    setPendingLength(initialLengthMeters);
    setLengthInputSegmentIndex(segments.length);
    setShowLengthInput(true);
  }, [points, segments.length, pixelsPerMeter, isShapeClosed]);

  // Enhanced length confirm that handles closing shape
  const enhancedHandleLengthConfirm = useCallback((length: number) => {
    const wasClosing = isClosingShapeRef.current;
    
    if (wasClosing && points.length >= 3) {
      // Closing the shape: connect last point to first point
      const lastPoint = points[points.length - 1];
      const firstPoint = points[0];
      const axis = snapToAxis(lastPoint, firstPoint);
      const lengthInPixels = metersToPixels(length, pixelsPerMeter);
      
      // Determine direction
      let correctedEnd: Point;
      if (axis === 'horizontal') {
        const direction = firstPoint.x > lastPoint.x ? 1 : -1;
        correctedEnd = {
          x: lastPoint.x + direction * lengthInPixels,
          y: lastPoint.y,
        };
      } else {
        const direction = firstPoint.y > lastPoint.y ? 1 : -1;
        correctedEnd = {
          x: lastPoint.x,
          y: lastPoint.y + direction * lengthInPixels,
        };
      }

      // Add closing segment
      setSegments([
        ...segments,
        {
          start: lastPoint,
          end: correctedEnd,
          length,
        },
      ]);

      // Mark shape as closed
      setIsShapeClosed(true);
      isClosingShapeRef.current = false;
      setShowLengthInput(false);
      setLengthInputSegmentIndex(null);
      setActiveSegmentIndex(null);
    } else {
      // Normal segment creation/editing
      handleLengthConfirm(length);
    }
  }, [points, segments, handleLengthConfirm]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 flex border border-gray-300">
        {/* Left Panel - Reference File (40%) */}
        <div className="w-[40%] border-r border-gray-300 flex flex-col">
          <div className="p-4 border-b border-gray-300">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                Reference Image / PDF
              </label>
              {imageFileName && (
                <button
                  onClick={removeFile}
                  className="text-xs text-red-500 hover:text-red-700 underline"
                >
                  Remove
                </button>
              )}
            </div>
            {imageFileName ? (
              <p className="text-xs text-gray-500 truncate">{imageFileName}</p>
            ) : (
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-md p-3 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                }`}
              >
                <input {...getInputProps()} />
                <p className="text-sm text-gray-600">
                  {isDragActive ? 'Drop file here...' : 'Drag & drop or click to upload'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  JPG, PNG, GIF, WEBP, BMP, SVG, TIFF, PDF
                </p>
              </div>
            )}
            {imageError && (
              <p className="mt-2 text-sm text-red-600">{imageError}</p>
            )}
          </div>
          <div
            ref={imageContainerRef}
            className="flex-1 overflow-auto bg-gray-50 p-4 flex items-center justify-center"
          >
            {imageLoading ? (
              <div className="text-gray-400 text-center">
                <div className="inline-block w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mb-2" />
                <p className="text-sm">Loading file...</p>
              </div>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt="Reference"
                className="max-w-full max-h-full object-contain"
                style={{ imageRendering: 'auto' }}
              />
            ) : (
              <div className="text-gray-400 text-center">
                <p className="text-sm">Upload a reference image or PDF</p>
                <p className="text-xs mt-2">The file will be displayed here for reference only</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Canvas (60%) */}
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b border-gray-300 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Building Outline Editor</h2>
            <button
              onClick={handleCloseShape}
              disabled={points.length < 3 || isShapeClosed}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
            >
              Close Shape
            </button>
          </div>
          <div
            ref={canvasContainerRef}
            className="flex-1 relative overflow-auto bg-gray-100"
            style={{ minHeight: '600px' }}
          >
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <CanvasLayer
                width={Math.max(800, canvasWidth - 32)}
                height={Math.max(600, canvasHeight - 32)}
                points={points}
                segments={segments}
                currentPreviewPoint={currentPreviewPoint}
                activeSegmentIndex={activeSegmentIndex}
                pixelsPerMeter={pixelsPerMeter}
                isShapeClosed={isShapeClosed}
                onCanvasClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onSegmentClick={handleSegmentClick}
              />
              <LengthInputOverlay
                position={lengthInputPosition}
                length={pendingLength}
                onConfirm={enhancedHandleLengthConfirm}
                onCancel={handleLengthCancel}
                visible={showLengthInput}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Perimeter Display */}
      <div className="border-t border-gray-300 bg-white p-4">
        <div className="max-w-4xl mx-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Walls:</h3>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {getWallLengths().map((wall) => (
              <div key={wall.index} className="text-sm text-gray-600">
                Wall {wall.index} – {wall.length.toFixed(2)} m
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-gray-200">
            <span className="text-base font-semibold text-gray-800">
              Total Perimeter: {getPerimeter().toFixed(2)} m
            </span>
          </div>
        </div>
      </div>

      {/* Scaffold Height Input — shown when shape is closed */}
      {isShapeClosed && (
        <div className="border-t border-gray-300 bg-white p-4">
          <div className="max-w-4xl mx-auto">
            <label
              htmlFor="scaffold-height"
              className="block text-sm font-semibold text-gray-700 mb-1"
            >
              Scaffold Height (m):
            </label>
            <input
              id="scaffold-height"
              type="number"
              min="0.1"
              step="0.1"
              value={scaffoldHeight}
              onChange={(e) => setScaffoldHeight(e.target.value)}
              placeholder="e.g. 10"
              className="w-48 px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {/* Kusabi Ashiba Estimation Result */}
      {kusabiResult && (
        <div className="border-t-2 border-blue-500 bg-blue-50 p-4">
          <div className="max-w-4xl mx-auto">
            <h3 className="text-base font-bold text-blue-800 mb-3">
              KUSABI ASHIBA ESTIMATION
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-200">
                <span className="block text-xs text-gray-500 mb-1">Perimeter</span>
                <span className="text-lg font-semibold text-gray-800">
                  {kusabiResult.totalPerimeter.toFixed(2)} m
                </span>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-200">
                <span className="block text-xs text-gray-500 mb-1">Levels</span>
                <span className="text-lg font-semibold text-gray-800">
                  {kusabiResult.levels}
                </span>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-200">
                <span className="block text-xs text-gray-500 mb-1">Total Spans</span>
                <span className="text-lg font-semibold text-gray-800">
                  {kusabiResult.totalSpans}
                </span>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-200">
                <span className="block text-xs text-gray-500 mb-1">Tateji Required</span>
                <span className="text-lg font-semibold text-gray-800">
                  {kusabiResult.tateji}
                </span>
              </div>
              <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-200">
                <span className="block text-xs text-gray-500 mb-1">Yokoji (Base Only)</span>
                <span className="text-lg font-semibold text-gray-800">
                  {kusabiResult.yokoji}
                </span>
              </div>
            </div>

            {/* Per-wall breakdown */}
            <details className="mt-4">
              <summary className="text-sm font-medium text-blue-700 cursor-pointer hover:text-blue-900">
                Per-wall breakdown
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-blue-200">
                      <th className="text-left py-1 px-2 text-gray-600">Wall</th>
                      <th className="text-right py-1 px-2 text-gray-600">Length (m)</th>
                      <th className="text-right py-1 px-2 text-gray-600">Spans</th>
                      <th className="text-right py-1 px-2 text-gray-600">Tateji</th>
                      <th className="text-right py-1 px-2 text-gray-600">Yokoji</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kusabiResult.walls.map((wall) => (
                      <tr key={wall.wallIndex} className="border-b border-blue-100">
                        <td className="py-1 px-2 text-gray-700">Wall {wall.wallIndex + 1}</td>
                        <td className="py-1 px-2 text-right text-gray-700">{wall.wallLength.toFixed(2)}</td>
                        <td className="py-1 px-2 text-right text-gray-700">{wall.spanCount}</td>
                        <td className="py-1 px-2 text-right text-gray-700">{wall.tateji}</td>
                        <td className="py-1 px-2 text-right text-gray-700">{wall.yokoji}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
