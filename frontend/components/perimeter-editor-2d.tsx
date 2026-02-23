'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PerimeterModel, PerimeterPoint, PerimeterSegment } from '@/lib/perimeter-model';

/**
 * ═══════════════════════════════════════════════════════════
 * Perimeter Editor 2D — Orthographic Top-Down View
 * ═══════════════════════════════════════════════════════════
 *
 * Uses THREE.OrthographicCamera (Z=0 plane).
 * ONLY uses: THREE.Line, THREE.BufferGeometry, THREE.Points
 * NEVER uses: ShapeGeometry, Mesh, ExtrudeGeometry
 * NEVER creates 3D scaffold geometry.
 *
 * Interaction:
 *   - Click: Add point to perimeterModel
 *   - Drag point: Move point via raycasting
 *   - Click segment: Input new dimension
 *   - Right-click or double-click: Close polygon
 */

interface BackgroundSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PerimeterEditor2DProps {
  model: PerimeterModel;
  /** Width of the container in pixels */
  width?: number;
  /** Height of the container in pixels */
  height?: number;
  /** Whether editing is enabled (false = view only) */
  editable?: boolean;
  /** Called when model data changes */
  onModelChange?: () => void;
  /** Grid size in mm (default 1000mm = 1m) */
  gridSize?: number;
  /** All DXF line segments to render as a background reference layer */
  backgroundGeometry?: BackgroundSegment[];
  /** Optional background image (e.g. uploaded PDF preview/image) */
  backgroundImageUrl?: string | null;
  backgroundImageResolution?: { width: number; height: number } | null;
}

// Colors
const POINT_COLOR = 0x2563eb; // blue-600
const POINT_HOVER_COLOR = 0xf59e0b; // amber-500
const LINE_COLOR = 0x1e40af; // blue-800
const LINE_CLOSE_COLOR = 0x16a34a; // green-600
const GRID_COLOR = 0xe5e7eb; // gray-200
const GRID_AXIS_COLOR = 0x9ca3af; // gray-400
const DIMENSION_COLOR = 0xdc2626; // red-600
const CURSOR_LINE_COLOR = 0x94a3b8; // slate-400
const BG_GEOMETRY_COLOR = 0x9ca3af; // gray-400 — DXF background lines

export function PerimeterEditor2D({
  model,
  width = 800,
  height = 600,
  editable = true,
  onModelChange,
  gridSize = 1000,
  backgroundGeometry,
  backgroundImageUrl,
  backgroundImageResolution,
}: PerimeterEditor2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Interaction state
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [cursorWorldPos, setCursorWorldPos] = useState<{ x: number; y: number } | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const cameraOffsetRef = useRef({ x: 0, y: 0 });

  // Objects that persist across renders
  const pointsMeshRef = useRef<THREE.Points | null>(null);
  const linesRef = useRef<THREE.Line[]>([]);
  const dimensionLabelsRef = useRef<HTMLDivElement[]>([]);
  const cursorLineRef = useRef<THREE.Line | null>(null);
  const bgGeometryRef = useRef<THREE.LineSegments | null>(null);
  const bgImageMeshRef = useRef<THREE.Mesh | null>(null);
  const bgImageBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  // Camera zoom
  const zoomRef = useRef(1);

  // ── Initialize Three.js ──────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfafafa);
    sceneRef.current = scene;

    // Camera — orthographic top-down
    const aspect = width / height;
    const frustumSize = 20000; // 20m visible area
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      100,
    );
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Draw grid
    drawGrid(scene, frustumSize, gridSize);

    // Render loop
    const animate = () => {
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    return () => {
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentElement === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [width, height, gridSize]);

  // ── Draw background DXF geometry ───────────────────────

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous background geometry
    if (bgGeometryRef.current) {
      scene.remove(bgGeometryRef.current);
      bgGeometryRef.current.geometry.dispose();
      (bgGeometryRef.current.material as THREE.LineBasicMaterial).dispose();
      bgGeometryRef.current = null;
    }

    if (!backgroundGeometry || backgroundGeometry.length === 0) return;

    // Build a single LineSegments object from all DXF lines
    const positions: number[] = [];
    for (const seg of backgroundGeometry) {
      positions.push(seg.x1, seg.y1, -0.1); // Z=-0.1 to sit behind perimeter lines
      positions.push(seg.x2, seg.y2, -0.1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: BG_GEOMETRY_COLOR,
      transparent: true,
      opacity: 0.55,
    });

    const lineSegments = new THREE.LineSegments(geo, mat);
    bgGeometryRef.current = lineSegments;
    scene.add(lineSegments);

    // Auto-fit camera to show the full drawing
    fitToContent();
  }, [backgroundGeometry]);

  // ── Draw optional background image ─────────────────────

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous image layer
    if (bgImageMeshRef.current) {
      scene.remove(bgImageMeshRef.current);
      bgImageMeshRef.current.geometry.dispose();
      const mat = bgImageMeshRef.current.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
      bgImageMeshRef.current = null;
      bgImageBoundsRef.current = null;
    }

    if (!backgroundImageUrl) return;

    const loader = new THREE.TextureLoader();
    let cancelled = false;

    loader.load(
      backgroundImageUrl,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }

        // Keep image colors natural when available in this three.js version
        if ('colorSpace' in texture) {
          (texture as any).colorSpace = THREE.SRGBColorSpace;
        }

        const imgWidth = (texture.image as any)?.width || 1;
        const imgHeight = (texture.image as any)?.height || 1;

        // Use a fixed world size and preserve aspect ratio.
        // This gives users a visual reference layer in the 2D editor.
        const maxWorldSizeMm = 24000;
        let planeW = maxWorldSizeMm;
        let planeH = maxWorldSizeMm;
        if (imgWidth >= imgHeight) {
          planeH = maxWorldSizeMm * (imgHeight / imgWidth);
        } else {
          planeW = maxWorldSizeMm * (imgWidth / imgHeight);
        }

        const geo = new THREE.PlaneGeometry(planeW, planeH);
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0, -0.2);
        scene.add(mesh);

        bgImageMeshRef.current = mesh;
        bgImageBoundsRef.current = {
          minX: -planeW / 2,
          minY: -planeH / 2,
          maxX: planeW / 2,
          maxY: planeH / 2,
        };

        fitToContent();
      },
      undefined,
      (err) => {
        // Non-fatal: editor still works without the image layer.
        console.warn('Failed to load 2D editor background image:', err);
      },
    );

    return () => {
      cancelled = true;
      if (bgImageMeshRef.current) {
        scene.remove(bgImageMeshRef.current);
        bgImageMeshRef.current.geometry.dispose();
        const mat = bgImageMeshRef.current.material as THREE.MeshBasicMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
        bgImageMeshRef.current = null;
      }
      bgImageBoundsRef.current = null;
    };
  }, [backgroundImageUrl]);

  // ── Subscribe to model changes ───────────────────────────

  useEffect(() => {
    const unsubscribe = model.onChange(() => {
      rebuildSceneObjects();
      onModelChange?.();
    });

    // Initial build
    rebuildSceneObjects();

    return unsubscribe;
  }, [model, onModelChange]);

  // ── Rebuild scene from model data ────────────────────────

  const rebuildSceneObjects = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old lines
    for (const line of linesRef.current) {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.LineBasicMaterial).dispose();
    }
    linesRef.current = [];

    // Remove old points
    if (pointsMeshRef.current) {
      scene.remove(pointsMeshRef.current);
      pointsMeshRef.current.geometry.dispose();
      (pointsMeshRef.current.material as THREE.PointsMaterial).dispose();
      pointsMeshRef.current = null;
    }

    // Remove cursor line
    if (cursorLineRef.current) {
      scene.remove(cursorLineRef.current);
      cursorLineRef.current.geometry.dispose();
      (cursorLineRef.current.material as THREE.LineBasicMaterial).dispose();
      cursorLineRef.current = null;
    }

    const points = model.getPoints();
    const segments = model.getSegments();

    if (points.length === 0) return;

    // ── Draw points ──────────────────────────────────────
    const pointPositions = new Float32Array(points.length * 3);
    const pointColors = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i++) {
      pointPositions[i * 3] = points[i].x;
      pointPositions[i * 3 + 1] = points[i].y;
      pointPositions[i * 3 + 2] = 0;

      const isHovered = i === hoveredPointIndex;
      const color = new THREE.Color(isHovered ? POINT_HOVER_COLOR : POINT_COLOR);
      pointColors[i * 3] = color.r;
      pointColors[i * 3 + 1] = color.g;
      pointColors[i * 3 + 2] = color.b;
    }

    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
    pointGeo.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));

    const pointMat = new THREE.PointsMaterial({
      size: 12,
      sizeAttenuation: false,
      vertexColors: true,
    });

    pointsMeshRef.current = new THREE.Points(pointGeo, pointMat);
    scene.add(pointsMeshRef.current);

    // ── Draw segments (lines) ────────────────────────────
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const start = points[seg.startIndex];
      const end = points[seg.endIndex];

      const isClosing = model.isClosed && i === segments.length - 1;

      const lineGeo = new THREE.BufferGeometry();
      const linePositions = new Float32Array([
        start.x, start.y, 0,
        end.x, end.y, 0,
      ]);
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

      const lineMat = new THREE.LineBasicMaterial({
        color: isClosing ? LINE_CLOSE_COLOR : LINE_COLOR,
        linewidth: 2,
      });

      const line = new THREE.Line(lineGeo, lineMat);
      line.userData = { segmentIndex: i };
      scene.add(line);
      linesRef.current.push(line);
    }

    // ── Draw cursor preview line (if not closed) ─────────
    if (!model.isClosed && points.length > 0 && cursorWorldPos && editable) {
      const lastPoint = points[points.length - 1];
      const cursorGeo = new THREE.BufferGeometry();
      const cursorPositions = new Float32Array([
        lastPoint.x, lastPoint.y, 0,
        cursorWorldPos.x, cursorWorldPos.y, 0,
      ]);
      cursorGeo.setAttribute('position', new THREE.BufferAttribute(cursorPositions, 3));
      const cursorMat = new THREE.LineBasicMaterial({
        color: CURSOR_LINE_COLOR,
        linewidth: 1,
        transparent: true,
        opacity: 0.5,
      });
      cursorLineRef.current = new THREE.Line(cursorGeo, cursorMat);
      scene.add(cursorLineRef.current);
    }
  }, [model, hoveredPointIndex, cursorWorldPos, editable]);

  // ── Auto-fit camera to model ─────────────────────────────

  const fitToModel = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    const points = model.getPoints();
    if (points.length === 0) return;

    const bb = model.getBoundingBox();
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const w = Math.max(bb.maxX - bb.minX, 5000); // At least 5m visible
    const h = Math.max(bb.maxY - bb.minY, 5000);

    const aspect = width / height;
    const padding = 1.4; // 40% padding

    const frustumW = Math.max(w * padding, h * padding * aspect);
    const frustumH = frustumW / aspect;

    camera.left = cx - frustumW / 2;
    camera.right = cx + frustumW / 2;
    camera.top = cy + frustumH / 2;
    camera.bottom = cy - frustumH / 2;
    camera.updateProjectionMatrix();

    cameraOffsetRef.current = { x: cx, y: cy };
  }, [model, width, height]);

  /** Fit camera to the full extent of background geometry + model */
  const fitToContent = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // Include model points
    for (const pt of model.getPoints()) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }

    // Include background geometry
    if (backgroundGeometry) {
      for (const seg of backgroundGeometry) {
        minX = Math.min(minX, seg.x1, seg.x2);
        minY = Math.min(minY, seg.y1, seg.y2);
        maxX = Math.max(maxX, seg.x1, seg.x2);
        maxY = Math.max(maxY, seg.y1, seg.y2);
      }
    }

    // Include background image bounds
    if (bgImageBoundsRef.current) {
      const b = bgImageBoundsRef.current;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }

    if (!isFinite(minX)) return; // nothing to fit

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = Math.max(maxX - minX, 5000);
    const h = Math.max(maxY - minY, 5000);

    const aspect = width / height;
    const padding = 1.3;

    const frustumW = Math.max(w * padding, h * padding * aspect);
    const frustumH = frustumW / aspect;

    camera.left = cx - frustumW / 2;
    camera.right = cx + frustumW / 2;
    camera.top = cy + frustumH / 2;
    camera.bottom = cy - frustumH / 2;
    camera.updateProjectionMatrix();

    cameraOffsetRef.current = { x: cx, y: cy };
  }, [model, backgroundGeometry, width, height]);

  // ── Event handlers ───────────────────────────────────────

  const screenToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return { x: 0, y: 0 };

    const rect = container.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    const worldX = camera.left + (ndcX + 1) / 2 * (camera.right - camera.left);
    const worldY = camera.bottom + (ndcY + 1) / 2 * (camera.top - camera.bottom);

    return { x: worldX, y: worldY };
  }, []);

  const findNearestPoint = useCallback((worldX: number, worldY: number, threshold: number = 500): number | null => {
    const points = model.getPoints();
    let minDist = threshold;
    let nearestIdx: number | null = null;

    for (let i = 0; i < points.length; i++) {
      const dist = Math.hypot(points[i].x - worldX, points[i].y - worldY);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    }

    return nearestIdx;
  }, [model]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!editable) return;

    if (e.button === 1) {
      // Middle button: start panning
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 2) {
      // Right click: close polygon
      e.preventDefault();
      if (model.pointCount >= 3 && !model.isClosed) {
        model.closePolygon();
      }
      return;
    }

    if (e.button !== 0) return; // Left click only

    const world = screenToWorld(e.clientX, e.clientY);

    // Check if clicking near an existing point (to start dragging)
    const nearPoint = findNearestPoint(world.x, world.y);
    if (nearPoint !== null) {
      setDraggingPointIndex(nearPoint);
      return;
    }

    // Check if clicking near first point to close polygon
    if (!model.isClosed && model.pointCount >= 3) {
      const firstPoint = model.getPoint(0);
      if (firstPoint) {
        const distToFirst = Math.hypot(firstPoint.x - world.x, firstPoint.y - world.y);
        if (distToFirst < 500) {
          model.closePolygon();
          return;
        }
      }
    }

    // Add new point
    if (!model.isClosed) {
      // Snap to grid (optional - 100mm grid)
      const snapSize = 100;
      const snappedX = Math.round(world.x / snapSize) * snapSize;
      const snappedY = Math.round(world.y / snapSize) * snapSize;
      model.addPoint(snappedX, snappedY);
    }
  }, [editable, model, screenToWorld, findNearestPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const world = screenToWorld(e.clientX, e.clientY);

    // Panning
    if (isPanningRef.current && cameraRef.current) {
      const camera = cameraRef.current;
      const dx = (e.clientX - panStartRef.current.x) / width * (camera.right - camera.left);
      const dy = (e.clientY - panStartRef.current.y) / height * (camera.top - camera.bottom);
      camera.left -= dx;
      camera.right -= dx;
      camera.top += dy;
      camera.bottom += dy;
      camera.updateProjectionMatrix();
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Dragging point
    if (draggingPointIndex !== null && editable) {
      model.movePoint(draggingPointIndex, world.x, world.y);
      return;
    }

    // Hover detection
    const nearPoint = findNearestPoint(world.x, world.y);
    setHoveredPointIndex(nearPoint);

    // Update cursor position for preview line
    setCursorWorldPos(world);
  }, [editable, draggingPointIndex, model, screenToWorld, findNearestPoint, width, height]);

  const handleMouseUp = useCallback(() => {
    setDraggingPointIndex(null);
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const camera = cameraRef.current;
    if (!camera) return;

    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;

    const world = screenToWorld(e.clientX, e.clientY);

    // Zoom towards cursor
    const newLeft = world.x + (camera.left - world.x) * zoomFactor;
    const newRight = world.x + (camera.right - world.x) * zoomFactor;
    const newTop = world.y + (camera.top - world.y) * zoomFactor;
    const newBottom = world.y + (camera.bottom - world.y) * zoomFactor;

    camera.left = newLeft;
    camera.right = newRight;
    camera.top = newTop;
    camera.bottom = newBottom;
    camera.updateProjectionMatrix();

    zoomRef.current *= zoomFactor;
  }, [screenToWorld]);

  const handleDoubleClick = useCallback(() => {
    if (!editable) return;
    if (model.pointCount >= 3 && !model.isClosed) {
      model.closePolygon();
    }
  }, [editable, model]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editable) return;

      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        model.removeLastPoint();
      }
      if (e.key === 'Escape') {
        model.clear();
      }
      if (e.key === 'f' || e.key === 'F') {
        fitToContent();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editable, model, fitToContent]);

  // ── Dimension labels (HTML overlay) ──────────────────────

  const getDimensionLabels = useCallback(() => {
    const segments = model.getSegments();
    const points = model.getPoints();
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container || segments.length === 0) return [];

    const rect = container.getBoundingClientRect();

    return segments.map((seg, i) => {
      const start = points[seg.startIndex];
      const end = points[seg.endIndex];
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;

      // Convert world to screen
      const screenX = ((midX - camera.left) / (camera.right - camera.left)) * rect.width;
      const screenY = ((camera.top - midY) / (camera.top - camera.bottom)) * rect.height;

      const lengthM = (seg.length / 1000).toFixed(2);
      const isManual = seg.manualLengthOverride;

      return {
        key: `dim-${i}`,
        x: screenX,
        y: screenY,
        text: `${lengthM}m`,
        isManual,
        segIndex: i,
      };
    });
  }, [model]);

  const handleSegmentClick = useCallback((segIndex: number) => {
    if (!editable) return;

    const seg = model.getSegment(segIndex);
    if (!seg) return;

    const currentMm = seg.length;
    const input = prompt(
      `Enter new length for segment ${segIndex + 1} (current: ${(currentMm / 1000).toFixed(2)}m):\n` +
      `Value in meters (e.g., 5.4):`,
      (currentMm / 1000).toFixed(3),
    );

    if (input !== null && input.trim()) {
      const newLengthM = parseFloat(input.trim());
      if (!isNaN(newLengthM) && newLengthM > 0) {
        model.updateSegmentLength(segIndex, newLengthM * 1000);
      }
    }
  }, [editable, model]);

  const [dimLabels, setDimLabels] = useState<Array<{
    key: string;
    x: number;
    y: number;
    text: string;
    isManual: boolean;
    segIndex: number;
  }>>([]);

  // Update labels on model change
  useEffect(() => {
    const unsubscribe = model.onChange(() => {
      setDimLabels(getDimensionLabels());
    });
    setDimLabels(getDimensionLabels());
    return unsubscribe;
  }, [model, getDimensionLabels]);

  // ── Toolbar ──────────────────────────────────────────────

  return (
    <div className="relative" style={{ width, height }}>
      {/* Three.js canvas container */}
      <div
        ref={containerRef}
        style={{ width, height, cursor: draggingPointIndex !== null ? 'grabbing' : hoveredPointIndex !== null ? 'grab' : 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Dimension labels overlay */}
      {dimLabels.map(label => (
        <div
          key={label.key}
          className={`absolute pointer-events-auto cursor-pointer text-xs font-mono px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap transform -translate-x-1/2 -translate-y-1/2
            ${label.isManual ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-white text-red-700 border border-red-200'}`}
          style={{ left: label.x, top: label.y }}
          onClick={() => handleSegmentClick(label.segIndex)}
          title={label.isManual ? 'Manual override (click to edit)' : 'Auto-calculated (click to override)'}
        >
          {label.text}
          {label.isManual && <span className="ml-1 text-amber-500">✎</span>}
        </div>
      ))}

      {/* Status bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gray-900/80 text-white text-xs px-3 py-1.5 flex items-center gap-4">
        <span>Points: {model.pointCount}</span>
        <span>Segments: {model.segmentCount}</span>
        <span>Perimeter: {(model.getPerimeter() / 1000).toFixed(2)}m</span>
        {model.isClosed && <span className="text-green-400">● Closed</span>}
        {!model.isClosed && model.pointCount > 0 && (
          <span className="text-yellow-400">○ Open — click near first point or double-click to close</span>
        )}
        {editable && (
          <span className="ml-auto text-gray-400">
            Click: add point | Drag: move point | Scroll: zoom | Ctrl+Z: undo | F: fit
          </span>
        )}
      </div>

      {/* Toolbar buttons */}
      {editable && (
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <button
            className="bg-white border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50 shadow-sm"
            onClick={() => fitToContent()}
            title="Fit to content (F)"
          >
            ⊞ Fit
          </button>
          <button
            className="bg-white border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50 shadow-sm"
            onClick={() => model.removeLastPoint()}
            title="Undo last point (Ctrl+Z)"
          >
            ↩ Undo
          </button>
          <button
            className="bg-white border border-gray-300 rounded px-2 py-1 text-xs hover:bg-red-50 shadow-sm text-red-600"
            onClick={() => model.clear()}
            title="Clear all (Esc)"
          >
            ✕ Clear
          </button>
          {!model.isClosed && model.pointCount >= 3 && (
            <button
              className="bg-green-600 text-white rounded px-2 py-1 text-xs hover:bg-green-700 shadow-sm"
              onClick={() => model.closePolygon()}
              title="Close polygon"
            >
              ◆ Close
            </button>
          )}
        </div>
      )}

      {/* Point index labels */}
      {model.getPoints().map((pt, i) => {
        const camera = cameraRef.current;
        const container = containerRef.current;
        if (!camera || !container) return null;

        const rect = container.getBoundingClientRect();
        const screenX = ((pt.x - camera.left) / (camera.right - camera.left)) * rect.width;
        const screenY = ((camera.top - pt.y) / (camera.top - camera.bottom)) * rect.height;

        return (
          <div
            key={`pt-label-${i}`}
            className="absolute pointer-events-none text-[10px] font-bold text-blue-700 bg-blue-50 rounded-full w-4 h-4 flex items-center justify-center border border-blue-300"
            style={{ left: screenX - 8, top: screenY - 20 }}
          >
            {String.fromCharCode(65 + (i % 26))}
          </div>
        );
      })}
    </div>
  );
}

// ── Grid drawing helper ──────────────────────────────────

function drawGrid(scene: THREE.Scene, extent: number, gridSize: number) {
  const gridRange = extent;
  const majorStep = gridSize * 5;

  // Minor grid
  const minorPositions: number[] = [];
  for (let x = -gridRange; x <= gridRange; x += gridSize) {
    minorPositions.push(x, -gridRange, 0, x, gridRange, 0);
  }
  for (let y = -gridRange; y <= gridRange; y += gridSize) {
    minorPositions.push(-gridRange, y, 0, gridRange, y, 0);
  }

  const minorGeo = new THREE.BufferGeometry();
  minorGeo.setAttribute('position', new THREE.Float32BufferAttribute(minorPositions, 3));
  const minorMat = new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.5 });
  scene.add(new THREE.LineSegments(minorGeo, minorMat));

  // Major grid
  const majorPositions: number[] = [];
  for (let x = -gridRange; x <= gridRange; x += majorStep) {
    majorPositions.push(x, -gridRange, 0, x, gridRange, 0);
  }
  for (let y = -gridRange; y <= gridRange; y += majorStep) {
    majorPositions.push(-gridRange, y, 0, gridRange, y, 0);
  }

  const majorGeo = new THREE.BufferGeometry();
  majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorPositions, 3));
  const majorMat = new THREE.LineBasicMaterial({ color: GRID_AXIS_COLOR, transparent: true, opacity: 0.4 });
  scene.add(new THREE.LineSegments(majorGeo, majorMat));

  // Axis lines
  const axisPositions = [
    -gridRange, 0, 0, gridRange, 0, 0, // X axis
    0, -gridRange, 0, 0, gridRange, 0, // Y axis
  ];
  const axisGeo = new THREE.BufferGeometry();
  axisGeo.setAttribute('position', new THREE.Float32BufferAttribute(axisPositions, 3));
  const axisMat = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.6 });
  scene.add(new THREE.LineSegments(axisGeo, axisMat));
}
