'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  scaffoldConfigsApi,
  CreateScaffoldConfigDto,
  ScaffoldRules,
  WallInput,
  WallSegment,
} from '@/lib/api/scaffold-configs';
import { subscriptionsApi } from '@/lib/api/subscriptions';
import { useI18n } from '@/lib/i18n';
import { PerimeterModel } from '@/lib/perimeter-model';
import {
  Calculator,
  Building2,
  ArrowRight,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  LayoutList,
  Zap,
  PenTool,
  ScanLine,
  Upload,
  Check,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { QuickShapeBuilder, type QuickShapeConfig } from '@/components/quick-shape-builder';
import { visionBimApi, type VisionFootprintResult, type VisionMassingTier } from '@/lib/api/vision-bim';
import { ScaffoldManager } from '@/lib/scaffold-manager';
import { getAiBimDefaults } from '@/lib/ai-bim-rules';
import {
  extractBimFacadeColorsFromImageFile,
  isRasterImageUpload,
} from '@/lib/bim-facade-colors';
import { computeBimPreviewPlanToM } from '@/lib/bim-preview-plan-coords';
import { synthesizeMassingTiersFromWallHeights } from '@/lib/synthesize-massing-tiers-from-wall-heights';
import { BuildingScaffoldSettingsPanel } from '@/components/scaffold/building-scaffold-settings-panel';
import { edgeChordName } from '@/lib/edge-hashira-labels';
import { inferVertexCornerKindsFromPolygonMm } from '@/lib/corner-kinds';
import { VertexCornerKindsPanel } from '@/components/scaffold/vertex-corner-kinds-panel';

function ScaffoldCadCanvasLoading() {
  const { t } = useI18n();
  return (
    <div className="h-96 flex items-center justify-center text-gray-400 bg-gray-900 rounded-xl">
      {t('scaffold', 'cadCanvasLoading')}
    </div>
  );
}

function ScaffoldDrawingUploadLoading() {
  const { t } = useI18n();
  return (
    <div className="h-96 flex items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200">
      {t('scaffold', 'drawingUploadLoading')}
    </div>
  );
}

const CadDrawingCanvas = dynamic(
  () => import('@/components/cad-drawing-canvas').then(m => ({ default: m.CadDrawingCanvas })),
  { ssr: false, loading: () => <ScaffoldCadCanvasLoading /> },
);

// Dynamic import for DrawingUpload (uses browser APIs)
const DrawingUpload = dynamic(
  () =>
    import('@/components/drawing-upload/DrawingUpload').then(m => ({
      default: m.DrawingUpload,
    })),
  {
    ssr: false,
    loading: () => <ScaffoldDrawingUploadLoading />,
  },
);

// ─── Types ──────────────────────────────────────────────────

interface WallState {
  side: string;
  enabled: boolean;
  lengthMm: number;
  heightMm: number;
  scaffoldWidthMm?: number;
  stairAccessCount: number;
  kaidanCount: number;
  kaidanOffsets: number[];
  isMultiSegment: boolean;
  segments: WallSegment[];
  /** Optional per-edge note (drawing upload side panel); not sent to calculation API. */
  cfNote?: string;
}

function calcTotalFromSegments(segments: WallSegment[]): number {
  if (segments.length === 0) return 0;
  let total = 0;
  for (const seg of segments) total += seg.lengthMm;
  for (let i = 1; i < segments.length; i++) {
    total += Math.abs(segments[i].offsetMm - segments[i - 1].offsetMm);
  }
  return total;
}

const WAKUGUMI_FIXED_FRAME_HEIGHT_MM = 1700;

type WakugumiFrameSeriesId = NonNullable<CreateScaffoldConfigDto['wakugumiFrameSeries']>;

function scaffoldWidthMmFromWakugumiSeries(s: WakugumiFrameSeriesId): 600 | 900 | 1200 {
  if (s === 'FT617') return 600;
  if (s === 'FT917') return 900;
  return 1200;
}

function wakugumiSeriesFromScaffoldWidthMm(w: number): WakugumiFrameSeriesId {
  if (w <= 600) return 'FT617';
  if (w <= 900) return 'FT917';
  return 'FT1217';
}

/** Count corners that need pattanko (non-L-shaped, i.e. angle not ~90°). Same threshold as 3D view: |cos| >= 0.35. */
function countPattankoCorners(vertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>): number {
  const n = vertices.length;
  if (n < 3) return 0;
  const COS_L_SHAPED_MAX = 0.35;
  const COS_STRAIGHT_MIN = 0.98;
  let count = 0;
  for (let j = 0; j < n; j++) {
    const prev = (j - 1 + n) % n;
    const next = (j + 1) % n;
    const vPrev = vertices[prev];
    const vJ = vertices[j];
    const vNext = vertices[next];
    const xPrev = (vPrev?.x ?? vPrev?.xFrac) ?? 0;
    const yPrev = (vPrev?.y ?? vPrev?.yFrac) ?? 0;
    const xJ = (vJ?.x ?? vJ?.xFrac) ?? 0;
    const yJ = (vJ?.y ?? vJ?.yFrac) ?? 0;
    const xNext = (vNext?.x ?? vNext?.xFrac) ?? 0;
    const yNext = (vNext?.y ?? vNext?.yFrac) ?? 0;
    const dxPrev = xJ - xPrev;
    const dyPrev = yJ - yPrev;
    const dxNext = xNext - xJ;
    const dyNext = yNext - yJ;
    const lenPrev = Math.hypot(dxPrev, dyPrev);
    const lenNext = Math.hypot(dxNext, dyNext);
    if (lenPrev < 1e-9 || lenNext < 1e-9) continue;
    const cosAngle = (dxPrev * dxNext + dyPrev * dyNext) / (lenPrev * lenNext);
    if (Math.abs(cosAngle) >= COS_STRAIGHT_MIN) continue;
    if (Math.abs(cosAngle) >= COS_L_SHAPED_MAX) count++;
  }
  return count;
}

/** Fix likely mis-read: leading digit dropped on plan (e.g. 3.593 m → 33.593 m, 1.3 m → 31.3 m). */
function correctWallLengthsMm(lengths: number[] | undefined): number[] | undefined {
  if (!Array.isArray(lengths) || lengths.length < 2) return lengths;
  let out = lengths;
  // Case 1: exactly one value 3xxx (e.g. 3593) when dimension was 33.593 m – fix even if another small (e.g. 1733) exists
  const threeK = out.filter((l) => l >= 3000 && l < 4000);
  const hasLarge = out.some((l) => l >= 10000);
  if (threeK.length === 1 && hasLarge) {
    out = out.map((l) => (l >= 3000 && l < 4000 ? l + 30000 : l));
  }
  // Case 2: exactly one value 1xxx–5xxx and all others >= 10000 (single small edge)
  const small = out.filter((l) => l >= 1000 && l < 6000);
  const large = out.filter((l) => l >= 10000);
  if (small.length === 1 && large.length === out.length - 1) {
    out = out.map((l) => (l >= 1000 && l < 6000 ? l + 30000 : l));
  }
  return out;
}

// IFC support removed

type PreviewPlanVertex = { x?: number; y?: number; xFrac?: number; yFrac?: number };

function previewVertexXY(v: PreviewPlanVertex): { x: number; y: number } {
  return {
    x: v.xFrac ?? v.x ?? 0,
    y: v.yFrac ?? v.y ?? 0,
  };
}

function previewBounds(verts: PreviewPlanVertex[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  spanX: number;
  spanY: number;
} {
  const pts = verts.map(previewVertexXY);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    spanX: Math.max(maxX - minX, 1e-9),
    spanY: Math.max(maxY - minY, 1e-9),
  };
}

function isFractionLikePreviewVerts(verts: PreviewPlanVertex[]): boolean {
  if (verts.length < 3) return false;
  const { minX, minY, maxX, maxY, spanX, spanY } = previewBounds(verts);
  const maxCoord = Math.max(Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
  return maxCoord <= 1.1 && Math.max(spanX, spanY) <= 1.1;
}

function previewPolygonArea(verts: PreviewPlanVertex[]): number {
  if (verts.length < 3) return 0;
  const pts = verts.map(previewVertexXY);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

function normalizeMassingTiersForPreview(
  outline: Array<{ xFrac: number; yFrac: number }>,
  massingTiers?: VisionMassingTier[],
): VisionMassingTier[] {
  if (!Array.isArray(massingTiers) || massingTiers.length === 0 || outline.length < 3) return [];

  const outlineIsFraction = isFractionLikePreviewVerts(outline);
  const outlineBox = previewBounds(outline);
  const outlineArea = Math.max(previewPolygonArea(outline), 1e-9);

  return massingTiers
    .filter((tier) => Array.isArray(tier.vertices) && tier.vertices.length >= 3)
    .map((tier) => {
      const tierVerts = tier.vertices as PreviewPlanVertex[];
      const tierIsFraction = isFractionLikePreviewVerts(tierVerts);

      if (tierIsFraction && !outlineIsFraction) {
        return {
          ...tier,
          vertices: tierVerts.map((v) => {
            const p = previewVertexXY(v);
            return {
              x: Math.round(outlineBox.minX + p.x * outlineBox.spanX),
              y: Math.round(outlineBox.minY + p.y * outlineBox.spanY),
            };
          }),
        } satisfies VisionMassingTier;
      }

      return tier;
    })
    .filter((tier) => {
      const area = previewPolygonArea(tier.vertices as PreviewPlanVertex[]);
      // Reject tiers that are effectively invisible or wildly larger than the base footprint.
      return area >= outlineArea * 0.002 && area <= outlineArea * 1.1;
    });
}

/** Renders building footprint outline as SVG (for AI extraction confirmation). */
function BuildingShapeSvg({
  outline,
  wallLengthsMm,
  className,
}: {
  outline: Array<{ xFrac: number; yFrac: number }>;
  wallLengthsMm?: number[];
  className?: string;
}) {
  if (outline.length < 3) return <div className={className} />;
  const xs = outline.map((p) => p.xFrac);
  const ys = outline.map((p) => p.yFrac);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const nx = (x: number) => (x - minX) / w;
  const ny = (y: number) => (y - minY) / h;
  const points = outline.map((p) => `${nx(p.xFrac)},${ny(p.yFrac)}`).join(' ');
  const labels = wallLengthsMm?.map((lenMm, i) => {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const mx = nx((a.xFrac + b.xFrac) / 2);
    const my = ny((a.yFrac + b.yFrac) / 2);
    return { mx, my, text: `${(lenMm / 1000).toFixed(3)}m` };
  }) ?? [];
  return (
    <svg viewBox="-0.1 -0.1 1.2 1.2" preserveAspectRatio="xMidYMid meet" className={className}>
      <polygon points={points} fill="#e0e7ff" stroke="#6366f1" strokeWidth={0.025} />
      {labels.map((l, i) => (
        <text key={i} x={l.mx} y={l.my} textAnchor="middle" dominantBaseline="middle"
          fontSize={0.07} fill="#3730a3" fontFamily="system-ui, sans-serif" fontWeight="600">
          {l.text}
        </text>
      ))}
    </svg>
  );
}

/** 3D building preview — renders extruded footprint with Three.js (for confirmation). */
function Building3DPreview({
  outline,
  buildingHeightMm,
  wallLengthsMm,
  wallHeightsMm,
  massingTiers,
  className,
  style,
}: {
  outline: Array<{ xFrac: number; yFrac: number }>;
  buildingHeightMm: number;
  wallLengthsMm?: number[];
  wallHeightsMm?: number[];
  massingTiers?: VisionMassingTier[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || outline.length < 3) return;
    let disposed = false;
    const cleanupFns: Array<() => void> = [];
    setPreviewError(null);
    const previewMassingTiers = normalizeMassingTiersForPreview(outline, massingTiers);

    import('three').then((THREE) => {
      if (disposed || !containerRef.current) return;

      const container = containerRef.current;
      const w = container.clientWidth;
      const h = container.clientHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf8fafc);

      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const { toPlanM, planSpanXM, planSpanZM } = computeBimPreviewPlanToM({
        outline,
        massingTiers: previewMassingTiers,
        wallLengthsMm,
      });

      const pts2D = toPlanM(outline);
      const cx = pts2D.reduce((s, p) => s + p.x, 0) / pts2D.length;
      const cz = pts2D.reduce((s, p) => s + p.z, 0) / pts2D.length;

      // Validate that the outline has non-zero area (degenerate → invisible geometry)
      const spreadX = Math.max(...pts2D.map(p => p.x)) - Math.min(...pts2D.map(p => p.x));
      const spreadZ = Math.max(...pts2D.map(p => p.z)) - Math.min(...pts2D.map(p => p.z));
      if (spreadX < 0.01 && spreadZ < 0.01) {
        setPreviewError('建物形状が小さすぎて3D描画できません。壁面長を確認してください。');
        return;
      }

      const heightM = buildingHeightMm * 0.001;
      const hasSteppedHeights = Array.isArray(wallHeightsMm) && wallHeightsMm.length === outline.length
        && new Set(wallHeightsMm).size > 1;

      const fallbackGroup = new THREE.Group();
      const hasMassingTiers = previewMassingTiers.length > 0;

      if (hasMassingTiers) {
        const tiers = [...previewMassingTiers]
          .filter((tier) => Array.isArray(tier.vertices) && tier.vertices.length >= 3)
          .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0) || a.topHeightMm - b.topHeightMm);
        const tierMat = new THREE.MeshStandardMaterial({
          color: 0xd4d8e0, metalness: 0.1, roughness: 0.7,
          side: THREE.DoubleSide, transparent: true, opacity: 0.85,
        });
        for (const tier of tiers) {
          const tierPts = toPlanM(tier.vertices);
          if (tierPts.length < 3) continue;
          const shape = new THREE.Shape();
          shape.moveTo(tierPts[0].x - cx, -(tierPts[0].z - cz));
          for (let i = 1; i < tierPts.length; i++) {
            shape.lineTo(tierPts[i].x - cx, -(tierPts[i].z - cz));
          }
          shape.closePath();
          const baseH = Math.max(0, (tier.baseHeightMm ?? 0) * 0.001);
          const topH = Math.max(baseH + 0.2, tier.topHeightMm * 0.001);
          const tierGeo = new THREE.ExtrudeGeometry(shape, { depth: topH - baseH, bevelEnabled: false });
          const tierMesh = new THREE.Mesh(tierGeo, tierMat);
          tierMesh.rotation.x = -Math.PI / 2;
          tierMesh.position.y = baseH;
          fallbackGroup.add(tierMesh);

          const tierEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(tierGeo),
            new THREE.LineBasicMaterial({ color: 0x94a3b8 }),
          );
          tierEdges.rotation.x = -Math.PI / 2;
          tierEdges.position.y = baseH;
          fallbackGroup.add(tierEdges);

          for (let floorY = Math.ceil(baseH / 3) * 3; floorY < topH; floorY += 3) {
            const floorPts = tierPts.map((p) => new THREE.Vector3(p.x - cx, floorY, p.z - cz));
            floorPts.push(floorPts[0].clone());
            fallbackGroup.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(floorPts),
              new THREE.LineBasicMaterial({ color: 0xbdc3cf, transparent: true, opacity: 0.5 }),
            ));
          }
        }
      } else if (hasSteppedHeights) {
        // Stepped building: create per-wall panels at their own heights
        const buildingMat = new THREE.MeshStandardMaterial({
          color: 0xd4d8e0, metalness: 0.1, roughness: 0.7,
          side: THREE.DoubleSide, transparent: true, opacity: 0.85,
        });
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x94a3b8 });
        const n = pts2D.length;

        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const p0x = pts2D[i].x - cx;
          const p0z = pts2D[i].z - cz;
          const p1x = pts2D[j].x - cx;
          const p1z = pts2D[j].z - cz;
          const wH = (wallHeightsMm![i] ?? buildingHeightMm) * 0.001;

          const positions = new Float32Array([
            p0x, 0, p0z,   p1x, 0, p1z,   p1x, wH, p1z,
            p0x, 0, p0z,   p1x, wH, p1z,  p0x, wH, p0z,
          ]);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geo.computeVertexNormals();
          fallbackGroup.add(new THREE.Mesh(geo, buildingMat));

          const wallEdgePts = [
            new THREE.Vector3(p0x, 0, p0z), new THREE.Vector3(p1x, 0, p1z),
            new THREE.Vector3(p1x, wH, p1z), new THREE.Vector3(p0x, wH, p0z),
            new THREE.Vector3(p0x, 0, p0z),
          ];
          fallbackGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(wallEdgePts), edgeMat,
          ));
        }

        // Top caps: for each edge, create a horizontal line at its height
        const floorH = 3;
        const uniqueHeights = [...new Set(wallHeightsMm!)].sort((a, b) => a - b);
        for (const h of uniqueHeights) {
          const hM = h * 0.001;
          const capPts = pts2D
            .filter((_, i) => (wallHeightsMm![i] ?? buildingHeightMm) >= h)
            .map((p) => new THREE.Vector3(p.x - cx, hM, p.z - cz));
          if (capPts.length >= 3) {
            capPts.push(capPts[0].clone());
            fallbackGroup.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(capPts),
              new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.4 }),
            ));
          }
        }

        // Floor lines per-wall
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const wH = (wallHeightsMm![i] ?? buildingHeightMm) * 0.001;
          for (let floorY = floorH; floorY < wH; floorY += floorH) {
            const pts = [
              new THREE.Vector3(pts2D[i].x - cx, floorY, pts2D[i].z - cz),
              new THREE.Vector3(pts2D[j].x - cx, floorY, pts2D[j].z - cz),
            ];
            fallbackGroup.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({ color: 0xbdc3cf, transparent: true, opacity: 0.5 }),
            ));
          }
        }
      } else {
        // Uniform height: single extrusion
        // Negate Z because ExtrudeGeometry + rotation.x=-PI/2 maps Shape Y → world -Z
        const shape = new THREE.Shape();
        shape.moveTo(pts2D[0].x - cx, -(pts2D[0].z - cz));
        for (let i = 1; i < pts2D.length; i++) {
          shape.lineTo(pts2D[i].x - cx, -(pts2D[i].z - cz));
        }
        shape.closePath();

        const buildingGeo = new THREE.ExtrudeGeometry(shape, { depth: heightM, bevelEnabled: false });
        const buildingMat = new THREE.MeshStandardMaterial({
          color: 0xd4d8e0, metalness: 0.1, roughness: 0.7,
          side: THREE.DoubleSide, transparent: true, opacity: 0.85,
        });
        const buildingMesh = new THREE.Mesh(buildingGeo, buildingMat);
        buildingMesh.rotation.x = -Math.PI / 2;
        buildingMesh.position.y = 0;
        fallbackGroup.add(buildingMesh);

        const edgesGeo = new THREE.EdgesGeometry(buildingGeo);
        const edges = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0x94a3b8 }));
        edges.rotation.x = -Math.PI / 2;
        fallbackGroup.add(edges);

        const floorH = 3;
        for (let floorY = floorH; floorY < heightM; floorY += floorH) {
          const floorPts = pts2D.map((p) => new THREE.Vector3(p.x - cx, floorY, p.z - cz));
          floorPts.push(floorPts[0].clone());
          fallbackGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(floorPts),
            new THREE.LineBasicMaterial({ color: 0xbdc3cf, transparent: true, opacity: 0.5 }),
          ));
        }
      }

      scene.add(fallbackGroup);

      // Outline on ground
      const outlinePts = pts2D.map((p) => new THREE.Vector3(p.x - cx, 0.01, p.z - cz));
      outlinePts.push(outlinePts[0].clone());
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outlineLine = new THREE.Line(outlineGeo, new THREE.LineBasicMaterial({ color: 0x6366f1, linewidth: 2 }));
      scene.add(outlineLine);

      // Ground plane
      const extent = Math.max(planSpanXM, planSpanZM, heightM) * 2;
      const groundGeo = new THREE.PlaneGeometry(extent * 3, extent * 3);
      const groundMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.9 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.01;
      ground.receiveShadow = true;
      scene.add(ground);

      const gridHelper = new THREE.GridHelper(extent * 3, 30, 0xd1d5db, 0xd1d5db);
      gridHelper.position.y = 0;
      (gridHelper.material as THREE.Material).opacity = 0.25;
      (gridHelper.material as THREE.Material).transparent = true;
      scene.add(gridHelper);

      // Lights
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(extent, extent * 1.5, extent * 0.8);
      scene.add(dirLight);

      // Camera
      const dist = Math.max(extent * 1.8, heightM * 2, 8);
      // Camera from south (+Z) with small east offset so +X maps strongly
      // to screen-right, matching the 2D plan left-right orientation.
      camera.position.set(dist * 0.2, dist * 0.6, dist * 0.85);
      camera.lookAt(0, heightM * 0.35, 0);
      camera.far = dist * 10;
      camera.updateProjectionMatrix();

      // Simple orbit via mouse drag
      const target = new THREE.Vector3(0, heightM * 0.35, 0);
      const spherical = new THREE.Spherical().setFromVector3(
        new THREE.Vector3().subVectors(camera.position, target),
      );
      let dragging = false;
      let prevX = 0;
      let prevY = 0;

      const onDown = (e: MouseEvent) => { dragging = true; prevX = e.clientX; prevY = e.clientY; };
      const onUp = () => { dragging = false; };
      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        prevX = e.clientX;
        prevY = e.clientY;
        spherical.theta -= dx * 0.005;
        spherical.phi = Math.max(0.2, Math.min(Math.PI * 0.48, spherical.phi - dy * 0.005));
        const v = new THREE.Vector3().setFromSpherical(spherical);
        camera.position.copy(target.clone().add(v));
        camera.lookAt(target);
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        spherical.radius = Math.max(2, Math.min(dist * 3, spherical.radius + e.deltaY * 0.02));
        const v = new THREE.Vector3().setFromSpherical(spherical);
        camera.position.copy(target.clone().add(v));
        camera.lookAt(target);
      };

      renderer.domElement.addEventListener('mousedown', onDown);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('mousemove', onMove);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
      cleanupFns.push(() => renderer.domElement.removeEventListener('mousedown', onDown));
      cleanupFns.push(() => window.removeEventListener('mouseup', onUp));
      cleanupFns.push(() => window.removeEventListener('mousemove', onMove));
      cleanupFns.push(() => renderer.domElement.removeEventListener('wheel', onWheel));

      const animate = () => {
        if (disposed) return;
        animFrameRef.current = requestAnimationFrame(animate);
        renderer.render(scene, camera);
      };
      animate();

      // Resize handling
      const ro = new ResizeObserver(() => {
        if (!container || disposed) return;
        const nw = container.clientWidth;
        const nh = container.clientHeight;
        renderer.setSize(nw, nh);
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
      });
      ro.observe(container);
      cleanupFns.push(() => ro.disconnect());
    }).catch((err) => {
      console.error('[Building3DPreview] render error:', err);
      setPreviewError('3D プレビューの描画に失敗しました');
    });

    return () => {
      disposed = true;
      for (const fn of cleanupFns) fn();
      cancelAnimationFrame(animFrameRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [outline, buildingHeightMm, wallLengthsMm, wallHeightsMm, massingTiers]);

  if (outline.length < 3) return <div className={className} style={style} />;
  if (previewError) {
    return (
      <div className={`flex items-center justify-center text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg ${className ?? ''}`} style={style}>
        {previewError}
      </div>
    );
  }
  return <div ref={containerRef} className={className} style={style} />;
}

// ─── Manual building geometry: single closed footprint, walls derived from it ───

type FootprintPoint = { xFrac: number; yFrac: number };

/** Distance between two points (mm). */
function distMm(a: FootprintPoint, b: FootprintPoint): number {
  const dx = b.xFrac - a.xFrac;
  const dy = b.yFrac - a.yFrac;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTierVertexMm(v: { x?: number; y?: number; xFrac?: number; yFrac?: number }): { x: number; y: number } {
  const x = typeof v.xFrac === 'number' ? v.xFrac : (typeof v.x === 'number' ? v.x : 0);
  const y = typeof v.yFrac === 'number' ? v.yFrac : (typeof v.y === 'number' ? v.y : 0);
  return { x, y };
}

/** True when tier footprint matches the building outline (same vertex count and positions). */
function tierMatchesFootprintOutline(
  tier: VisionMassingTier,
  footprintMm: FootprintPoint[],
  tolMm: number,
): boolean {
  const n = footprintMm.length;
  if (!tier.vertices || tier.vertices.length !== n) return false;
  for (let i = 0; i < n; i++) {
    const p = getTierVertexMm(tier.vertices[i]);
    if (Math.hypot(p.x - footprintMm[i].xFrac, p.y - footprintMm[i].yFrac) > tolMm) return false;
  }
  return true;
}

/**
 * After editing the footprint polygon, shift massing tier vertices that matched the old outline.
 * Tiers with different footprints (setbacks) are left unchanged on XY.
 */
function remapMassingTiersAfterFootprintEdit(
  tiers: VisionMassingTier[] | undefined,
  oldOutline: FootprintPoint[],
  newOutline: FootprintPoint[],
): VisionMassingTier[] | undefined {
  if (!tiers?.length) return tiers;
  const n = newOutline.length;
  if (oldOutline.length !== n) return undefined;
  const tolMm = 5;
  return tiers.map((tier) => {
    if (tier.vertices.length !== n) return tier;
    if (tierMatchesFootprintOutline(tier, oldOutline, tolMm)) {
      return {
        ...tier,
        vertices: newOutline.map((p) => ({ x: Math.round(p.xFrac), y: Math.round(p.yFrac) })),
      };
    }
    return tier;
  });
}

/**
 * Build a single closed polygon footprint from manual dimensions.
 * Vertices are ordered so edge i is vertex[i] → vertex[(i+1) % n]; the last edge explicitly closes to the first.
 * Used only for manual quick-shape input; does not affect upload/CAD geometry.
 */
function buildClosedFootprintFromQuickShape(
  config: QuickShapeConfig,
): { vertices: FootprintPoint[] } {
  const sides = config.sides;
  if (sides.length < 3) return { vertices: [] };

  if (config.shapeType === 'rectangle' && sides.length === 4) {
    const w = sides[0].lengthMm;
    const d = sides[1].lengthMm;
    const vertices: FootprintPoint[] = [
      { xFrac: 0, yFrac: 0 },
      { xFrac: w, yFrac: 0 },
      { xFrac: w, yFrac: d },
      { xFrac: 0, yFrac: d },
    ];
    return { vertices };
  }

  if (config.shapeType === 'l-shape' && sides.length === 6) {
    // Rectilinear L: A→B (E), B→C (N), C→D (E), D→E (S), E→F (W), F→A (N). All in mm.
    const [ab, bc, cd, de, ef] = sides.map((s) => s.lengthMm);
    const vertices: FootprintPoint[] = [
      { xFrac: 0, yFrac: 0 },
      { xFrac: ab, yFrac: 0 },
      { xFrac: ab, yFrac: bc },
      { xFrac: ab + cd, yFrac: bc },
      { xFrac: ab + cd, yFrac: bc - de },
      { xFrac: ab + cd - ef, yFrac: bc - de },
    ];
    // Closure: last edge is vertex[5] → vertex[0]. Length is derived when building walls.
    return { vertices };
  }

  // Custom (or any other) polygon: build chain with equal exterior angles for first n-1 segments,
  // then close with last edge (n-1)→0 so the footprint is guaranteed closed.
  const n = sides.length;
  const extAngle = (2 * Math.PI) / n;
  let angle = 0;
  let cx = 0;
  let cy = 0;
  const vertices: FootprintPoint[] = [{ xFrac: 0, yFrac: 0 }];
  for (let i = 0; i < n - 1; i++) {
    const len = sides[i].lengthMm;
    cx += len * Math.cos(angle);
    cy += len * Math.sin(angle);
    angle += extAngle;
    vertices.push({ xFrac: cx, yFrac: cy });
  }
  // Last edge is (n-1) → 0; we do not add a duplicate first point. Closure is explicit when deriving walls.
  return { vertices };
}

/**
 * Derive wall inputs from a closed footprint loop.
 * Each wall = one edge: vertex[i] → vertex[(i+1) % n]. Length is taken from the polygon, not from user input.
 */
function deriveWallsFromClosedFootprint(
  vertices: FootprintPoint[],
  config: QuickShapeConfig,
): WallInput[] {
  const n = vertices.length;
  if (n < 3) return [];

  const sides = config.sides;
  const buildingHeightMm = config.buildingHeightMm;
  const kaidanPerSide = config.kaidanPerSide ?? {};

  const scaffoldWidthPerSide = config.scaffoldWidthPerSide ?? {};
  return Array.from({ length: n }, (_, i) => {
    const next = (i + 1) % n;
    const lengthMm = Math.round(distMm(vertices[i], vertices[next]));
    const label = sides[i]?.label ?? `edge-${i}`;
    const stairAccessCount = kaidanPerSide[label]?.enabled ? kaidanPerSide[label].count : 0;
    const scaffoldWidthMm = scaffoldWidthPerSide[label] ?? config.scaffoldWidthMm;
    return {
      side: label,
      wallLengthMm: lengthMm,
      wallHeightMm: buildingHeightMm,
      stairAccessCount,
      scaffoldWidthMm,
      kaidanCount: 0,
      kaidanOffsets: [],
    };
  });
}

// ─── Page Component ─────────────────────────────────────────

export default function ScaffoldPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
      <ScaffoldPageContent />
    </Suspense>
  );
}

function ScaffoldPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();

  // ─── Input Mode ────────────────────────────────────────
  const [inputMode, setInputMode] = useState<'drawing' | 'quick' | 'ai_extract' | 'cad_draw'>('drawing');
  const [manualSubTab, setManualSubTab] = useState<'drawing' | 'quick'>('drawing');
  /** First calculate after CAD complete — tag config as cad_draw until saved */
  const [pendingInputUiPath, setPendingInputUiPath] = useState<CreateScaffoldConfigDto['inputUiPath'] | null>(null);
  const [aiBimUploading, setAiBimUploading] = useState(false);
  const [aiBimError, setAiBimError] = useState<string | null>(null);
  /** After AI extract: show for double-check before creating config. */
  const [aiBimPreview, setAiBimPreview] = useState<{
    buildingHeightMm: number;
    walls: WallInput[];
    buildingOutline: Array<{ xFrac: number; yFrac: number }>;
    massingTiers?: VisionMassingTier[];
    scaffoldType: 'kusabi' | 'wakugumi';
    frameSizeMm?: number;
    wakugumiFrameSeries?: WakugumiFrameSeriesId;
    wallLengthsFromDimText?: boolean;
    heightConfidence?: 'high' | 'medium' | 'low';
    drawingType?: 'plan' | '3d' | 'elevation' | 'section';
    isStepped?: boolean;
    obstacles?: Array<
      | { type: 'balcony' | 'ac'; vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }> }
      | { type: 'pillar'; center: { x: number; y: number } | { xFrac: number; yFrac: number }; radiusMm: number }
      | { type: 'door'; wallIndex?: number; positionMm?: number; widthMm?: number }
    >;
    dto: CreateScaffoldConfigDto;
  } | null>(null);
  const [aiBimConfirming, setAiBimConfirming] = useState(false);
  /** Snapshot of AI-extracted footprint for compare / reset (mm polygon, same as buildingOutline). */
  const [aiBimExtractOutline, setAiBimExtractOutline] = useState<FootprintPoint[] | null>(null);
  const [aiBimCompareExtract, setAiBimCompareExtract] = useState(false);
  const scaffoldManagerRef = useRef<ScaffoldManager | null>(null);
  if (!scaffoldManagerRef.current) scaffoldManagerRef.current = new ScaffoldManager();

  const handleAiBimOutlineEdit = useCallback((nextOutline: FootprintPoint[]) => {
    setAiBimPreview((prev) => {
      if (!prev) return prev;
      const n = nextOutline.length;
      if (n < 3) return prev;

      const closedOutline = nextOutline.map((p) => ({ xFrac: p.xFrac, yFrac: p.yFrac }));
      const oldOutline = prev.buildingOutline;

      let newWalls: WallInput[];
      if (prev.walls.length === n) {
        newWalls = prev.walls.map((w, i) => {
          const j = (i + 1) % n;
          const len = Math.round(distMm(closedOutline[i], closedOutline[j]));
          return { ...w, wallLengthMm: Math.max(600, len) };
        });
      } else {
        const pw = prev.walls;
        const lastI = Math.max(0, pw.length - 1);
        newWalls = Array.from({ length: n }, (_, i) => {
          const j = (i + 1) % n;
          const len = Math.max(600, Math.round(distMm(closedOutline[i], closedOutline[j])));
          const w0 = pw[Math.min(i, lastI)] ?? pw[0];
          return {
            side: `edge-${i}`,
            wallLengthMm: len,
            wallHeightMm: w0?.wallHeightMm ?? prev.buildingHeightMm,
            stairAccessCount: w0?.stairAccessCount ?? 0,
            scaffoldWidthMm: w0?.scaffoldWidthMm ?? prev.dto.scaffoldWidthMm,
            kaidanCount: 0,
            kaidanOffsets: [],
          };
        });
      }

      const newMassing = remapMassingTiersAfterFootprintEdit(prev.massingTiers, oldOutline, closedOutline);

      return {
        ...prev,
        buildingOutline: closedOutline,
        walls: newWalls,
        massingTiers: newMassing && newMassing.length > 0 ? newMassing : undefined,
        dto: {
          ...prev.dto,
          buildingOutline: closedOutline,
          walls: newWalls,
          massingTiers: newMassing && newMassing.length > 0 ? newMassing : undefined,
        },
      };
    });
  }, []);

  // ─── Perimeter Model ────────────────────────────────────
  const [perimeterModel] = useState(() => new PerimeterModel());

  // ─── Form state ─────────────────────────────────────────
  const [scaffoldType, setScaffoldType] = useState<'kusabi' | 'wakugumi'>('kusabi');
  const [structureType, setStructureType] = useState<'改修工事' | 'S造' | 'RC造'>('改修工事');
  const [scaffoldWidthMm, setScaffoldWidthMm] = useState(600);
  // Kusabi-specific
  const [preferredMainTatejiMm, setPreferredMainTatejiMm] = useState(1800);
  // Wakugumi-specific
  const [frameSizeMm, setFrameSizeMm] = useState(1700);
  const [wakugumiFrameSeries, setWakugumiFrameSeries] = useState<WakugumiFrameSeriesId>('FT917');
  const [habakiCountPerSpan, setHabakiCountPerSpan] = useState(2);
  const [endStopperType, setEndStopperType] = useState<'nuno' | 'frame'>('nuno');
  const [walls, setWalls] = useState<WallState[]>([]);
  const [buildingHeightMm, setBuildingHeightMm] = useState<number | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedWallIdx, setSelectedWallIdx] = useState<number | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [cornerKindsUseManual, setCornerKindsUseManual] = useState(false);
  const [vertexCornerKinds, setVertexCornerKinds] = useState<Array<'convex' | 'reflex'>>([]);

  const editConfigId = searchParams.get('edit') ?? null;

  const { data: editConfig, isLoading: editConfigLoading } = useQuery({
    queryKey: ['scaffold-config', editConfigId!],
    queryFn: () => scaffoldConfigsApi.get(editConfigId!),
    enabled: !!editConfigId,
    staleTime: 0,
  });

  useEffect(() => {
    if (!editConfigId || !editConfig) return;
    setScaffoldType(editConfig.scaffoldType);
    setStructureType(editConfig.structureType || '改修工事');
    const baseW = editConfig.scaffoldWidthMm ?? 600;
    if (editConfig.scaffoldType === 'wakugumi') {
      const s = editConfig.wakugumiFrameSeries;
      if (s === 'FT617' || s === 'FT917' || s === 'FT1217') {
        setWakugumiFrameSeries(s);
        setScaffoldWidthMm(scaffoldWidthMmFromWakugumiSeries(s));
      } else {
        setScaffoldWidthMm(baseW);
        setWakugumiFrameSeries(wakugumiSeriesFromScaffoldWidthMm(baseW));
      }
      setFrameSizeMm(WAKUGUMI_FIXED_FRAME_HEIGHT_MM);
    } else {
      setScaffoldWidthMm(baseW);
      setFrameSizeMm(editConfig.frameSizeMm ?? 1700);
    }
    setPreferredMainTatejiMm(editConfig.preferredMainTatejiMm ?? 1800);
    setHabakiCountPerSpan(editConfig.habakiCountPerSpan ?? 2);
    setEndStopperType((editConfig.endStopperType as 'nuno' | 'frame') ?? 'nuno');
    setBuildingHeightMm(editConfig.buildingHeightMm ?? null);
    const wallList = editConfig.walls ?? [];
    if (wallList.length > 0) {
      const buildingH = editConfig.buildingHeightMm ?? 3000;
      const mapped: WallState[] = wallList.map((w: any) => {
        const segs = w.segments && Array.isArray(w.segments) ? w.segments : [];
        const isMulti = segs.length > 0;
        const lengthMm = isMulti ? calcTotalFromSegments(segs) : (w.wallLengthMm ?? 0);
        return {
          side: w.side,
          enabled: w.enabled !== false,
          lengthMm,
          heightMm: w.wallHeightMm ?? buildingH,
          scaffoldWidthMm: (w as any).scaffoldWidthMm ?? undefined,
          stairAccessCount: w.stairAccessCount ?? 0,
          kaidanCount: 0,
          kaidanOffsets: [],
          isMultiSegment: isMulti,
          segments: segs.length > 0 ? segs : [{ lengthMm: w.wallLengthMm ?? 0, offsetMm: 0 }],
          cfNote: '',
        };
      });
      setWalls(mapped);
      setPrefilled(true);
      const vck = (editConfig.calculationResult as { vertexCornerKinds?: unknown } | undefined)
        ?.vertexCornerKinds;
      if (
        Array.isArray(vck) &&
        vck.length === wallList.length &&
        vck.every((k) => k === 'convex' || k === 'reflex')
      ) {
        setCornerKindsUseManual(true);
        setVertexCornerKinds(vck as Array<'convex' | 'reflex'>);
      } else {
        setCornerKindsUseManual(false);
        setVertexCornerKinds([]);
      }
    } else {
      setCornerKindsUseManual(false);
      setVertexCornerKinds([]);
    }
    const poly = editConfig.calculationResult?.polygonVertices;
    if (Array.isArray(poly) && poly.length >= 3) {
      setPolygonVertices(
        poly.map((p: { x?: number; y?: number; xFrac?: number; yFrac?: number }) => ({
          x: p.x ?? p.xFrac ?? 0,
          y: p.y ?? p.yFrac ?? 0,
        })),
      );
    }
    const uiPath = (editConfig.calculationResult as { uiInputPath?: CreateScaffoldConfigDto['inputUiPath'] } | undefined)
      ?.uiInputPath;
    if (uiPath === 'quick') setManualSubTab('quick');
    else setManualSubTab('drawing');
    setInputMode('drawing');
  }, [editConfigId, editConfig]);

  useEffect(() => {
    setSelectedWallIdx((prev) => {
      if (walls.length === 0) return null;
      if (prev == null) return 0;
      return Math.max(0, Math.min(prev, walls.length - 1));
    });
  }, [walls.length]);

  const closedFootprintChords =
    walls.length >= 3 && (perimeterModel.isClosed || polygonVertices.length >= 3);
  const wallChordAt = (index: number) =>
    edgeChordName(index, walls.length, closedFootprintChords);

  const footprintForPreview = useMemo(() => {
    if (!Array.isArray(polygonVertices) || polygonVertices.length < 3) return null;
    // Only show the preview when the polygon matches the wall count (1 edge per wall).
    if (walls.length >= 3 && polygonVertices.length === walls.length) {
      return polygonVertices;
    }
    return polygonVertices;
  }, [polygonVertices, walls.length]);

  useEffect(() => {
    if (!cornerKindsUseManual || walls.length < 3) return;
    setVertexCornerKinds((prev) => {
      const n = walls.length;
      if (prev.length === n) return prev;
      const next = prev.slice(0, n);
      while (next.length < n) next.push('convex');
      return next;
    });
  }, [walls.length, cornerKindsUseManual]);

  const FootprintMiniPreview = useCallback((props: {
    vertices: Array<{ x: number; y: number }>;
    labels: string[];
    activeIndex: number | null;
  }) => {
    const { vertices, labels, activeIndex } = props;
    const n = vertices.length;
    if (n < 3) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of vertices) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxY - minY);
    const pad = Math.max(w, h) * 0.12;
    const vb = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
    const points = vertices.map((p) => `${p.x},${p.y}`).join(' ');

    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    return (
      <svg viewBox={vb} className="w-full h-56 rounded-lg bg-gray-50 border border-gray-200" preserveAspectRatio="xMidYMid meet">
        <polygon points={points} fill="#eef2ff" stroke="#6366f1" strokeWidth={2} />
        {Array.from({ length: n }, (_, i) => {
          const a = vertices[i];
          const b = vertices[(i + 1) % n];
          const m = mid(a, b);
          const isActive = activeIndex === i;
          return (
            <g key={`edge-${i}`}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isActive ? '#f97316' : '#4f46e5'}
                strokeWidth={isActive ? 5 : 2.5}
                opacity={isActive ? 0.95 : 0.35}
                strokeLinecap="round"
              />
              <circle cx={a.x} cy={a.y} r={6} fill={isActive ? '#fb923c' : '#6366f1'} opacity={0.9} />
              <text
                x={m.x}
                y={m.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(10, Math.min(18, (w + h) / 220))}
                fill={isActive ? '#9a3412' : '#1f2937'}
                fontWeight={isActive ? 700 : 600}
                paintOrder="stroke"
                stroke="#ffffff"
                strokeWidth={4}
              >
                {labels[i] ?? `E${i + 1}`}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }, []);

  // ─── Fetch rules from backend ───────────────────────────
  const { data: rules, isError: rulesError, error: rulesErrorDetail } = useQuery<ScaffoldRules>({
    queryKey: ['scaffold-rules'],
    queryFn: () => scaffoldConfigsApi.getRules(),
    staleTime: 1000 * 60 * 30,
  });
  const subscriptionMessage = rulesError && (rulesErrorDetail as Error)?.message;

  const { data: subscriptionInfo } = useQuery({
    queryKey: ['my-subscription'],
    queryFn: subscriptionsApi.getMine,
    staleTime: 60_000,
    retry: false,
  });
  const caps = subscriptionInfo?.capabilities;
  const planGatesRelaxed = caps === undefined;
  const canAi = planGatesRelaxed || caps.aiExtract === true;
  const canCad = planGatesRelaxed || caps.cadDraw === true;
  const canFile = planGatesRelaxed || caps.fileUpload === true;
  const canQuick = planGatesRelaxed || caps.quickShape === true;

  useEffect(() => {
    if (planGatesRelaxed) return;
    if (inputMode === 'ai_extract' && !canAi) setInputMode('drawing');
    if (inputMode === 'cad_draw' && !canCad) setInputMode('drawing');
    if (!canFile && manualSubTab === 'drawing' && !editConfigId) {
      setManualSubTab('quick');
      setInputMode('quick');
    }
    if (!canQuick && inputMode === 'quick' && !editConfigId) {
      setInputMode('drawing');
      setManualSubTab('drawing');
    }
  }, [
    planGatesRelaxed,
    canAi,
    canCad,
    canFile,
    canQuick,
    inputMode,
    manualSubTab,
    editConfigId,
  ]);

  const calculateMutation = useMutation({
    mutationFn: ({
      dto,
      configId,
    }: {
      dto: CreateScaffoldConfigDto;
      configId?: string | null;
    }) =>
      configId
        ? scaffoldConfigsApi.updateAndRecalculate(configId, dto)
        : scaffoldConfigsApi.createAndCalculate(dto),
    onSuccess: (data) => {
      setPendingInputUiPath(null);
      router.push(`/scaffold/${data.config.id}`);
    },
  });

  const updateWall = (index: number, updates: Partial<WallState>) => {
    setWalls((prev) =>
      prev.map((w, i) => (i === index ? { ...w, ...updates } : w)),
    );
  };

  // ─── Walls detected from PerimeterTracer ────────────────
  const handleWallsDetected = useCallback(
    (
      detected: Array<{ side: string; lengthMm: number }>,
      vertices?: Array<{ x: number; y: number }>,
    ) => {
      if (vertices && vertices.length >= 3) {
        setPolygonVertices(vertices);
      }
      setWalls((prev) => {
        // Preserve existing wall settings (height, kaidan, multi-segment) when lengths update
        return detected.map((w, i) => {
          const existing = prev[i];
          if (existing && existing.side === w.side) {
            return { ...existing, lengthMm: w.lengthMm };
          }
          const defaultH =
            buildingHeightMm && buildingHeightMm >= 1000 ? buildingHeightMm : 3000;
          return {
            side: w.side,
            enabled: true,
            lengthMm: w.lengthMm,
            heightMm: defaultH,
            stairAccessCount: 0,
            kaidanCount: 0,
            kaidanOffsets: [],
            isMultiSegment: false,
            segments: [],
            cfNote: '',
          };
        });
      });
    },
    [buildingHeightMm],
  );

  // ─── Segment edited in tracer right panel → update wall ──
  const handleSegmentEdit = useCallback(
    (index: number, lengthMm: number) => {
      setWalls((prev) =>
        prev.map((w, i) => (i === index ? { ...w, lengthMm } : w)),
      );
    },
    [],
  );

  // ─── Calculate handler ──────────────────────────────────
  const handleCalculate = () => {
    if (!perimeterModel.isClosed && !prefilled) {
      alert(t('scaffold', 'closePolygonFirst'));
      return;
    }
    const enabledWalls: WallInput[] = [];
    const enabledOriginalIndices: number[] = [];
    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi];
      if (!w.enabled) continue;
      const lenMm = w.isMultiSegment ? calcTotalFromSegments(w.segments) : w.lengthMm;
      if (lenMm <= 0) continue;
      enabledOriginalIndices.push(wi);
      enabledWalls.push({
        side: w.side,
        wallLengthMm: lenMm,
        wallHeightMm: w.heightMm > 0 ? w.heightMm : (buildingHeightMm ?? 0),
        stairAccessCount: w.stairAccessCount,
        kaidanCount: w.kaidanCount,
        kaidanOffsets: w.kaidanOffsets,
        ...(w.isMultiSegment && w.segments.length > 0
          ? { isMultiSegment: true, segments: w.segments }
          : {}),
        ...(w.scaffoldWidthMm != null && { scaffoldWidthMm: w.scaffoldWidthMm }),
      });
    }

    if (enabledWalls.length === 0) {
      alert(t('scaffold', 'noEnabledWallSegments'));
      return;
    }

    const chordForOriginalIndex = (origIdx: number) =>
      edgeChordName(origIdx, walls.length, closedFootprintChords);

    // Validate minimum wall lengths (backend requires >= 600mm)
    const tooShortIdx = enabledOriginalIndices.filter((_, j) => enabledWalls[j]!.wallLengthMm < 600);
    if (tooShortIdx.length > 0) {
      alert(
        `${t('scaffold', 'wallsTooShortIntro')}\n${tooShortIdx.map((origIdx) => {
          const j = enabledOriginalIndices.indexOf(origIdx);
          return `${chordForOriginalIndex(origIdx)}: ${enabledWalls[j]!.wallLengthMm}mm`;
        }).join('\n')}\n\n${t('scaffold', 'wallsTooShortHint')}`,
      );
      return;
    }

    // Validate minimum wall heights (backend requires >= 1000mm)
    const tooLowIdx = enabledOriginalIndices.filter((_, j) => enabledWalls[j]!.wallHeightMm < 1000);
    if (tooLowIdx.length > 0) {
      alert(
        `${t('scaffold', 'wallsTooLowIntro')}\n${tooLowIdx.map((origIdx) => {
          const j = enabledOriginalIndices.indexOf(origIdx);
          return `${chordForOriginalIndex(origIdx)}: ${enabledWalls[j]!.wallHeightMm}mm`;
        }).join('\n')}\n\n${t('scaffold', 'wallsTooLowHint')}`,
      );
      return;
    }

    const dto: CreateScaffoldConfigDto = {
      projectId: editConfig?.projectId ?? 'default-project',
      mode: 'manual',
      scaffoldType,
      structureType,
      walls: enabledWalls,
      scaffoldWidthMm,
      siteName: '',
      siteAddress: '',
      siteEmail: '',
      sitePhone: '',
      siteFax: '',
      ...(scaffoldType === 'kusabi' && {
        preferredMainTatejiMm,
      }),
      ...(scaffoldType === 'wakugumi' && {
        frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
        wakugumiFrameSeries,
        habakiCountPerSpan,
        endStopperType,
      }),
      ...(polygonVertices.length >= 3 && polygonVertices.length === enabledWalls.length && {
        buildingOutline: polygonVertices.map((v) => ({ xFrac: v.x, yFrac: v.y })),
        pattankoCornerCount: countPattankoCorners(polygonVertices),
      }),
      ...(cornerKindsUseManual &&
        walls.length > 0 &&
        walls.every((w) => w.enabled) &&
        vertexCornerKinds.length === enabledWalls.length &&
        polygonVertices.length === enabledWalls.length && {
          vertexCornerKinds: [...vertexCornerKinds],
        }),
      inputUiPath: (() => {
        const stored = (editConfig?.calculationResult as { uiInputPath?: CreateScaffoldConfigDto['inputUiPath'] } | undefined)
          ?.uiInputPath;
        if (editConfigId && stored) return stored;
        if (pendingInputUiPath) return pendingInputUiPath;
        if (manualSubTab === 'quick') return 'quick';
        return 'drawing';
      })(),
    };
    calculateMutation.mutate({ dto, configId: editConfigId });
  };

  const handleQuickShapeSubmit = (qConfig: QuickShapeConfig) => {
    // 1) Build a single closed footprint from manual dimensions (manual path only; upload/CAD unchanged).
    const { vertices } = buildClosedFootprintFromQuickShape(qConfig);
    if (vertices.length < 3) return;
    // 2) Walls derived from footprint edges (each edge i → (i+1)%n); last edge explicitly closes to first.
    const wallInputs = deriveWallsFromClosedFootprint(vertices, qConfig);
    if (wallInputs.length === 0 || wallInputs.length !== vertices.length) return; // ensure closed loop

    const buildingOutline = vertices;

    const dto: CreateScaffoldConfigDto = {
      projectId: 'default-project',
      mode: 'manual',
      scaffoldType: qConfig.scaffoldType,
      structureType: qConfig.structureType,
      walls: wallInputs,
      scaffoldWidthMm: qConfig.scaffoldWidthMm,
      buildingOutline,
      pattankoCornerCount: countPattankoCorners(vertices),
      ...(qConfig.scaffoldType === 'kusabi' && {
        preferredMainTatejiMm: qConfig.preferredMainTatejiMm,
      }),
      ...(qConfig.scaffoldType === 'wakugumi' && {
        frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
        wakugumiFrameSeries:
          qConfig.wakugumiFrameSeries ?? wakugumiSeriesFromScaffoldWidthMm(qConfig.scaffoldWidthMm),
        habakiCountPerSpan: qConfig.habakiCountPerSpan,
        endStopperType: qConfig.endStopperType,
      }),
      ...(qConfig.edgeHashiraLabeling ? { edgeHashiraLabeling: qConfig.edgeHashiraLabeling } : {}),
      inputUiPath: 'quick',
    };
    calculateMutation.mutate({ dto, configId: null });
  };

  const aiUploadAccept = '.dxf,.ifc,.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp,application/dxf,image/vnd.dxf,application/pdf,image/png,image/jpeg,image/gif,image/webp,image/bmp,model/ifc,application/octet-stream';

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (editConfigId && editConfigLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">{t('scaffold', 'loadingConfig')}</span>
      </div>
    );
  }

  const savedUiInputPath = (editConfig?.calculationResult as { uiInputPath?: CreateScaffoldConfigDto['inputUiPath'] } | undefined)
    ?.uiInputPath;
  const showDrawingUpload =
    canFile &&
    ((manualSubTab === 'drawing' && !editConfigId) ||
      (!!editConfigId && savedUiInputPath !== 'quick' && savedUiInputPath !== 'ai_extract'));

  return (
    <div className="min-h-screen bg-gray-50" suppressHydrationWarning>
        {/* Header */}
      <div className="max-w-[1600px] mx-auto px-4 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Calculator className="h-7 w-7 text-blue-600" />
            {t('scaffold', 'title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{t('scaffold', 'subtitle')}</p>

          {/* ─── Mode Selector (4 sections) ─── */}
          {!editConfigId && (
            <div className="flex flex-wrap gap-2 mt-4">
              {canAi && (
                <button
                  type="button"
                  onClick={() => setInputMode('ai_extract')}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                    inputMode === 'ai_extract'
                      ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <ScanLine className="h-4 w-4" />
                  {t('scaffoldExtra', 'aiExtractTab')}
                </button>
              )}
              {(canFile || canQuick) && (
                <button
                  type="button"
                  onClick={() => {
                    if (canFile) {
                      setInputMode('drawing');
                      setManualSubTab('drawing');
                    } else {
                      setInputMode('quick');
                      setManualSubTab('quick');
                    }
                  }}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                    inputMode === 'drawing' || inputMode === 'quick'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Upload className="h-4 w-4" />
                  {canFile ? t('scaffoldExtra', 'fileUploadTab') : t('scaffoldExtra', 'quickBuilder')}
                </button>
              )}
              {canCad && (
                <button
                  type="button"
                  onClick={() => setInputMode('cad_draw')}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                    inputMode === 'cad_draw'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <PenTool className="h-4 w-4" />
                  {t('scaffoldExtra', 'cadDrawTab')}
                </button>
              )}
            </div>
          )}

          {!editConfigId && !planGatesRelaxed && (!canAi || !canCad) && (
            <p className="mt-3 text-xs text-gray-600 max-w-3xl">
              {!canAi && <span className="block">{t('scaffoldExtra', 'planGatePremiumOnly')}</span>}
              {!canCad && (
                <span className="block mt-1">{t('scaffoldExtra', 'planGateMediumOnly')}</span>
              )}
            </p>
          )}
          {!editConfigId && !planGatesRelaxed && canFile && !canAi && (
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 max-w-3xl">
              {t('scaffoldExtra', 'planGateFileUploadNote')}
            </p>
          )}

          {/* Subscription required (when rules fail with 403) */}
          {rulesError && subscriptionMessage && (
            <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>{subscriptionMessage}</span>
            </div>
          )}
        </div>

      {/* ═══════════════════════════════════════════════════════
          AI EXTRACTION / AI BIM/IFC MODES
         ═══════════════════════════════════════════════════════ */}
      {inputMode === 'ai_extract' && !editConfigId && (
        <div className="max-w-[1800px] mx-auto px-4 pb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-violet-600" />
              {t('scaffold', 'aiExtractModeTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {aiBimPreview
                ? t('scaffold', 'aiBimModeReady')
                : t('scaffold', 'aiExtractModeDescription')}
            </p>
            {!aiBimPreview && (
              <p className="text-xs text-violet-700/90 -mt-4 mb-6">
                {t('scaffold', 'aiExtractColorSamplingHint')}
              </p>
            )}
            {!aiBimPreview && (
            <>
            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-violet-300 rounded-xl cursor-pointer bg-violet-50/50 hover:bg-violet-50 transition-colors">
              <Upload className="h-10 w-10 text-violet-500 mb-2" />
              <span className="text-sm font-medium text-violet-700 mb-1">{t('scaffold', 'aiBimUploadCta')}</span>
              <span className="text-xs text-gray-500">
                {t('scaffold', 'aiExtractAcceptedFormats')}
              </span>
              <input
                type="file"
                className="hidden"
                accept={aiUploadAccept}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setAiBimError(null);
                  setAiBimUploading(true);
                  try {
                    const raw = await visionBimApi.analyze(file);
                    let bimFacadeColors: CreateScaffoldConfigDto['bimFacadeColors'];
                    if (isRasterImageUpload(file)) {
                      try {
                        const extracted = await extractBimFacadeColorsFromImageFile(file);
                        if (extracted) bimFacadeColors = extracted;
                      } catch {
                        /* sampling failed — fall back to default 3D palette */
                      }
                    }
                    const footprint = raw as VisionFootprintResult;
                    const obstacles = footprint.obstacles;
                    const manager = scaffoldManagerRef.current!;
                    const refMm = footprint.vertices.some((v) => 'xFrac' in v)
                      ? (footprint.scaleDenominator ? 20000 : 10000)
                      : undefined;
                    const wallLengthsMm = correctWallLengthsMm(footprint.wallLengthsMm) ?? footprint.wallLengthsMm;
                    // If AI returned pixel-scale wall heights (all < 1800mm), treat buildingHeightMm as authoritative
                    // and ignore per-wall heights (they'll be overridden by the sanitizer on submit anyway).
                    const wallHeightsMmRaw = footprint.wallHeightsMm;
                    const wallHeightsMm = Array.isArray(wallHeightsMmRaw) && wallHeightsMmRaw.length > 0
                      && wallHeightsMmRaw.every((h) => h < 1800)
                      ? undefined
                      : wallHeightsMmRaw;
                    const hasIfcMassingTiers =
                      Array.isArray(footprint.massingTiers) && footprint.massingTiers.length > 0;
                    // Tiers carry stepping; per-edge heights here only create jagged scaffold runs.
                    const wallHeightsForGraph = hasIfcMassingTiers ? undefined : wallHeightsMm;
                    const { walls, buildingOutline } = manager.injectFootprintAndGetWalls(
                      footprint.vertices,
                      footprint.buildingHeightMm,
                      refMm,
                      {
                        wallLengthsMm,
                        wallHeightsMm: wallHeightsForGraph,
                        allowSingleStepCollapse:
                          footprint.drawingType === '3d' &&
                          footprint.wallLengthsFromDimText !== true,
                      },
                    );
                    // Normalize massingTier vertices to mm (same coordinate space as buildingOutline).
                    // Compare massingTier vertices directly against buildingOutline — NOT
                    // footprint.vertices, which may already be converted to mm by the
                    // building graph pipeline, masking the mismatch.
                    const normalizedMassingTiers = (() => {
                      if (!footprint.massingTiers || footprint.massingTiers.length === 0) return undefined;
                      if (!buildingOutline || buildingOutline.length < 3) return footprint.massingTiers;
                      const getC = (v: any) => ({
                        x: typeof v.xFrac === 'number' ? v.xFrac : (typeof v.x === 'number' ? v.x : 0),
                        y: typeof v.yFrac === 'number' ? v.yFrac : (typeof v.y === 'number' ? v.y : 0),
                      });
                      const bboxOf = (pts: Array<{ x: number; y: number }>) => {
                        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
                        for (const p of pts) {
                          if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
                          if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y;
                        }
                        return { mnx, mny, mxx, mxy };
                      };
                      const outlinePts = buildingOutline.map((v: any) => getC(v));
                      const ob = bboxOf(outlinePts);
                      const outW = Math.max(ob.mxx - ob.mnx, 1e-9);
                      const outH = Math.max(ob.mxy - ob.mny, 1e-9);
                      const tierPts = footprint.massingTiers.flatMap((t: any) =>
                        Array.isArray(t.vertices) ? t.vertices.map(getC) : [],
                      );
                      if (tierPts.length === 0) return footprint.massingTiers;
                      const tb = bboxOf(tierPts);
                      const tierW = Math.max(tb.mxx - tb.mnx, 1e-9);
                      const tierH = Math.max(tb.mxy - tb.mny, 1e-9);
                      const spreadRatio = Math.max(outW, outH) / Math.max(tierW, tierH);
                      if (spreadRatio > 0.1 && spreadRatio < 10) {
                        return footprint.massingTiers;
                      }
                      return footprint.massingTiers.map((tier: any) => ({
                        ...tier,
                        vertices: Array.isArray(tier.vertices) ? tier.vertices.map((v: any) => {
                          const c = getC(v);
                          const nx = ob.mnx + ((c.x - tb.mnx) / tierW) * outW;
                          const ny = ob.mny + ((c.y - tb.mny) / tierH) * outH;
                          return { x: Math.round(nx), y: Math.round(ny) };
                        }) : tier.vertices,
                      }));
                    })();
                    // When massingTiers are missing but wallHeightsMm varies, auto-synthesize
                    // approximate tiers from the outline so decomposeTierWalls can work.
                    // Only create tiers when the upper tier has a genuinely SMALLER footprint.
                    const effectiveMassingTiers = (() => {
                      if (normalizedMassingTiers && normalizedMassingTiers.length > 0) return normalizedMassingTiers;
                      if (!Array.isArray(wallHeightsMm) || wallHeightsMm.length === 0) return undefined;
                      if (!buildingOutline || buildingOutline.length < 3) return undefined;
                      if (wallHeightsMm.length !== buildingOutline.length) return undefined;
                      const syn = synthesizeMassingTiersFromWallHeights(buildingOutline, wallHeightsMm);
                      return syn as VisionMassingTier[] | undefined;
                    })();
                    const defaults = getAiBimDefaults();
                    const scaffoldType = footprint.scaffoldTypeHint ?? 'kusabi';
                    const aiWkSeries = wakugumiSeriesFromScaffoldWidthMm(defaults.scaffoldWidthMm);
                    const dto: CreateScaffoldConfigDto = {
                      projectId: 'default-project',
                      mode: 'manual',
                      scaffoldType,
                      structureType: '改修工事',
                      walls,
                      scaffoldWidthMm: defaults.scaffoldWidthMm,
                      preferredMainTatejiMm: defaults.preferredMainTatejiMm,
                      ...(scaffoldType === 'wakugumi' && {
                        frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
                        wakugumiFrameSeries: aiWkSeries,
                      }),
                      buildingOutline,
                      ...(effectiveMassingTiers && effectiveMassingTiers.length > 0 && { massingTiers: effectiveMassingTiers }),
                      ...(obstacles && obstacles.length > 0 && { obstacles }),
                      ...(bimFacadeColors && { bimFacadeColors }),
                      inputUiPath: 'ai_extract',
                    };
                    const isStepped = Array.isArray(wallHeightsMm) && wallHeightsMm.length > 0
                      && new Set(walls.map((w) => w.wallHeightMm)).size > 1;
                    setAiBimPreview({
                      buildingHeightMm: footprint.buildingHeightMm,
                      walls,
                      buildingOutline,
                      massingTiers: effectiveMassingTiers,
                      scaffoldType,
                      frameSizeMm: scaffoldType === 'wakugumi' ? WAKUGUMI_FIXED_FRAME_HEIGHT_MM : undefined,
                      wakugumiFrameSeries: scaffoldType === 'wakugumi' ? aiWkSeries : undefined,
                      wallLengthsFromDimText: footprint.wallLengthsFromDimText,
                      heightConfidence: footprint.heightConfidence,
                      drawingType: footprint.drawingType,
                      isStepped,
                      obstacles,
                      dto,
                    });
                    setAiBimExtractOutline(
                      buildingOutline.map((p) => ({ xFrac: p.xFrac, yFrac: p.yFrac })),
                    );
                    setAiBimCompareExtract(false);
                    setAiBimError(null);
                  } catch (err: any) {
                    setAiBimError(err?.message || t('scaffold', 'aiBimAnalysisFailed'));
                  } finally {
                    setAiBimUploading(false);
                    e.target.value = '';
                  }
                }}
                disabled={aiBimUploading}
              />
            </label>
            {aiBimUploading && (
              <div className="mt-4 flex items-center gap-2 text-violet-600">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{t('scaffold', 'aiBimAnalyzing')}</span>
              </div>
            )}
            {aiBimError && (
              <div className="mt-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                {aiBimError}
              </div>
            )}
            </>
            )}

            {aiBimPreview && (
              <div className="flex flex-col lg:flex-row gap-4">
                {/* ── LEFT PANEL: 2D Plan Preview + Shape SVG ── */}
                <div className="w-full lg:w-[480px] lg:min-w-[420px] lg:flex-shrink-0 space-y-3">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      {t('scaffoldExtra', 'extractionComplete')}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-2">
                    <BuildingShapeSvg
                      outline={aiBimPreview.buildingOutline}
                      wallLengthsMm={aiBimPreview.walls.map((w) => w.wallLengthMm)}
                      className="w-full h-64"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAiBimPreview(null);
                        setAiBimExtractOutline(null);
                        setAiBimCompareExtract(false);
                        setAiBimError(null);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('scaffoldExtra', 'uploadAnotherFile')}
                    </button>
                  </div>
                </div>
                {/* ── RIGHT PANEL: Review, Wall Table, 3D, Settings ── */}
                <div className="flex-1 min-w-0 border border-gray-200 rounded-xl p-5 bg-gray-50/50 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-800">{t('scaffold', 'aiBimReviewTitle')}</h3>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {aiBimPreview.isStepped ? t('scaffold', 'aiBimMaxBuildingHeight') : t('scaffold', 'aiBimBuildingHeight')}
                    </label>
                    <input
                      type="number"
                      value={aiBimPreview.buildingHeightMm}
                      onChange={(e) => {
                        const h = Math.max(1000, Number(e.target.value) || 1000);
                        const newWalls = aiBimPreview.isStepped
                          ? aiBimPreview.walls.map((w) => w)
                          : aiBimPreview.walls.map((w) => ({ ...w, wallHeightMm: h }));
                        setAiBimPreview({
                          ...aiBimPreview,
                          buildingHeightMm: h,
                          walls: newWalls,
                          dto: { ...aiBimPreview.dto, walls: newWalls },
                        });
                      }}
                      min={1000}
                      step={100}
                      className="w-full max-w-[180px] rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-violet-500"
                    />
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(aiBimPreview.buildingHeightMm / 1000).toFixed(1)} m
                    </p>
                    {aiBimPreview.heightConfidence === 'low' && (
                      <div className="mt-1.5 flex items-start gap-1.5 p-2 rounded-md bg-amber-50 border border-amber-200">
                        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800">
                          {aiBimPreview.drawingType === 'plan'
                            ? t('scaffold', 'aiBimHeightEstimatedFromPlan')
                            : t('scaffold', 'aiBimHeightEstimatedGeneral')}
                        </p>
                      </div>
                    )}
                    {aiBimPreview.heightConfidence === 'medium' && (
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {t('scaffold', 'aiBimHeightEstimatedMedium')}
                      </p>
                    )}
                    {aiBimPreview.isStepped && (
                      <p className="text-xs text-violet-600 mt-1 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
                        {t('scaffold', 'aiBimSteppedDetected')}
                      </p>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500">{t('scaffold', 'aiBimWallLengthsTitle')}</span>
                      {aiBimPreview.wallLengthsFromDimText
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle2 size={12} />{t('scaffold', 'aiBimLengthsFromDimensions')}</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><AlertTriangle size={12} />{t('scaffold', 'aiBimLengthsFromVertices')}</span>
                      }
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-100 border-b border-gray-200">
                            <th className="text-left py-2 px-3 font-medium text-gray-700">{t('scaffold', 'aiBimWallHeader')}</th>
                            <th className="text-right py-2 px-3 font-medium text-gray-700">{t('scaffold', 'aiBimLengthHeader')}</th>
                            <th className="text-right py-2 px-3 font-medium text-gray-700">{t('scaffold', 'aiBimHeightHeader')}</th>
                            <th className="text-right py-2 px-3 font-medium text-gray-700">{t('scaffold', 'aiBimScaffoldWidthHeader')}</th>
                            <th className="text-right py-2 px-3 font-medium text-gray-700">{t('scaffold', 'aiBimStairCountHeader')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiBimPreview.walls.map((w, i) => (
                            <tr key={w.side} className={`border-b border-gray-100 last:border-0 ${aiBimPreview.isStepped && w.wallHeightMm !== aiBimPreview.buildingHeightMm ? 'bg-violet-50/50' : ''}`}>
                              <td className="py-2 px-3 text-gray-800 font-mono font-medium">
                                {edgeChordName(i, aiBimPreview.walls.length, aiBimPreview.walls.length >= 3)}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <input
                                  type="number"
                                  value={w.wallLengthMm}
                                  onChange={(e) => {
                                    const len = Math.max(600, Number(e.target.value) || 600);
                                    const newWalls = aiBimPreview.walls.map((wall, j) =>
                                      j === i ? { ...wall, wallLengthMm: len } : wall,
                                    );
                                    setAiBimPreview({
                                      ...aiBimPreview,
                                      walls: newWalls,
                                      dto: { ...aiBimPreview.dto, walls: newWalls },
                                    });
                                  }}
                                  min={600}
                                  step={100}
                                  className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-right font-mono focus:ring-2 focus:ring-violet-500"
                                />
                              </td>
                              <td className="py-2 px-3 text-right">
                                <input
                                  type="number"
                                  value={w.wallHeightMm ?? aiBimPreview.buildingHeightMm}
                                  onChange={(e) => {
                                    const h = Math.max(1000, Number(e.target.value) || 1000);
                                    const newWalls = aiBimPreview.walls.map((wall, j) =>
                                      j === i ? { ...wall, wallHeightMm: h } : wall,
                                    );
                                    const maxH = Math.max(...newWalls.map((wall) => wall.wallHeightMm ?? 0));
                                    const isStepped = new Set(newWalls.map((wall) => wall.wallHeightMm)).size > 1;
                                    setAiBimPreview({
                                      ...aiBimPreview,
                                      walls: newWalls,
                                      buildingHeightMm: maxH,
                                      isStepped,
                                      dto: { ...aiBimPreview.dto, walls: newWalls },
                                    });
                                  }}
                                  min={1000}
                                  step={100}
                                  className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-right font-mono focus:ring-2 focus:ring-violet-500"
                                />
                              </td>
                              <td className="py-2 px-3 text-right">
                                <select
                                  value={w.scaffoldWidthMm ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    const widthMm = v ? Number(v) : undefined;
                                    const newWalls = aiBimPreview.walls.map((wall, j) =>
                                      j === i ? { ...wall, scaffoldWidthMm: widthMm } : wall,
                                    );
                                    setAiBimPreview({
                                      ...aiBimPreview,
                                      walls: newWalls,
                                      dto: { ...aiBimPreview.dto, walls: newWalls },
                                    });
                                  }}
                                  className="rounded border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-violet-500"
                                >
                                  <option value="">{aiBimPreview.dto.scaffoldWidthMm}mm</option>
                                  {[600, 900, 1200].filter((wmm) => wmm !== aiBimPreview.dto.scaffoldWidthMm).map((wmm) => (
                                    <option key={wmm} value={wmm}>{wmm}mm</option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 px-3 text-right">
                                <select
                                  value={w.stairAccessCount ?? 0}
                                  onChange={(e) => {
                                    const count = Number(e.target.value) || 0;
                                    const len = w.wallLengthMm;
                                    const newOffsets: number[] =
                                      count === 0
                                        ? []
                                        : Array.from({ length: count }, (_, j) =>
                                            Math.round((len / (count + 1)) * (j + 1) / 100) * 100,
                                          );
                                    const newWalls = aiBimPreview.walls.map((wall, j) =>
                                      j === i
                                        ? {
                                            ...wall,
                                            stairAccessCount: count,
                                            kaidanCount: count,
                                            kaidanOffsets: newOffsets,
                                          }
                                        : wall,
                                    );
                                    setAiBimPreview({
                                      ...aiBimPreview,
                                      walls: newWalls,
                                      dto: { ...aiBimPreview.dto, walls: newWalls },
                                    });
                                  }}
                                  className="rounded border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-violet-500"
                                >
                                  {[0, 1, 2, 3, 4].map((n) => (
                                    <option key={n} value={n}>{n}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50 border-t border-gray-200">
                            <td className="py-2 px-3 text-xs font-semibold text-gray-600">{t('scaffold', 'aiBimPerimeterTotal')}</td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-gray-800">
                              {aiBimPreview.walls.reduce((s, w) => s + w.wallLengthMm, 0).toLocaleString()}
                            </td>
                            <td colSpan={3} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mt-4 space-y-4">
                      <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-blue-600" />
                        {t('scaffold', 'buildingSettings')}
                      </h2>
                      <p className="text-xs text-gray-500">
                        {(t('scaffold', 'siteContactOnResultPage') || 'Site name and address are entered on the results page before Excel export.')}
                      </p>
                      <div className="rounded-lg border border-violet-200 bg-gray-50/50 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-violet-700">{t('scaffold', 'aiBimConditionsTitle')}</span>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">{t('scaffold', 'structureType')}</label>
                          <select
                            value={aiBimPreview.dto.structureType ?? '改修工事'}
                            onChange={(e) => {
                              const v = e.target.value as '改修工事' | 'S造' | 'RC造';
                              setAiBimPreview({
                                ...aiBimPreview,
                                dto: { ...aiBimPreview.dto, structureType: v },
                              });
                            }}
                            className="w-full max-w-md rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500 bg-white"
                          >
                            <option value="改修工事">{t('scaffold', 'structureTypeRenovation')} (1.25x)</option>
                            <option value="S造">{t('scaffold', 'structureTypeSteel')} (1.0x)</option>
                            <option value="RC造">{t('scaffold', 'structureTypeConcrete')} (0.9x)</option>
                          </select>
                          <p className="text-[10px] text-gray-500 mt-0.5">{t('scaffold', 'structureTypeHint')}</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('scaffold', 'scaffoldTypeLabel')}</label>
                            <select
                              value={aiBimPreview.scaffoldType}
                              onChange={(e) => {
                                const nextType = e.target.value as 'kusabi' | 'wakugumi';
                                if (nextType === 'wakugumi') {
                                  const series = wakugumiSeriesFromScaffoldWidthMm(aiBimPreview.dto.scaffoldWidthMm);
                                  setAiBimPreview({
                                    ...aiBimPreview,
                                    scaffoldType: nextType,
                                    frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
                                    wakugumiFrameSeries: series,
                                    dto: {
                                      ...aiBimPreview.dto,
                                      scaffoldType: nextType,
                                      frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
                                      wakugumiFrameSeries: series,
                                      preferredMainTatejiMm: undefined,
                                    },
                                  });
                                } else {
                                  setAiBimPreview({
                                    ...aiBimPreview,
                                    scaffoldType: nextType,
                                    frameSizeMm: undefined,
                                    wakugumiFrameSeries: undefined,
                                    dto: {
                                      ...aiBimPreview.dto,
                                      scaffoldType: nextType,
                                      frameSizeMm: undefined,
                                      wakugumiFrameSeries: undefined,
                                      preferredMainTatejiMm: getAiBimDefaults().preferredMainTatejiMm,
                                    },
                                  });
                                }
                              }}
                              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500 bg-white"
                            >
                              <option value="kusabi">{t('scaffold', 'kusabiType')}</option>
                              <option value="wakugumi">{t('scaffold', 'wakugumiType')}</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('scaffold', 'aiBimScaffoldWidthHeader')}</label>
                            <select
                              value={aiBimPreview.dto.scaffoldWidthMm}
                              onChange={(e) => {
                                const width = Number(e.target.value) || 600;
                                const series = wakugumiSeriesFromScaffoldWidthMm(width);
                                setAiBimPreview({
                                  ...aiBimPreview,
                                  wakugumiFrameSeries:
                                    aiBimPreview.scaffoldType === 'wakugumi' ? series : aiBimPreview.wakugumiFrameSeries,
                                  dto: {
                                    ...aiBimPreview.dto,
                                    scaffoldWidthMm: width,
                                    ...(aiBimPreview.scaffoldType === 'wakugumi' && {
                                      wakugumiFrameSeries: series,
                                      frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
                                    }),
                                  },
                                });
                              }}
                              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500 bg-white"
                            >
                              {[600, 900, 1200].map((w) => (
                                <option key={w} value={w}>
                                  {w}mm
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              {aiBimPreview.scaffoldType === 'wakugumi'
                                ? t('scaffoldExtra', 'wakugumiFrameSeries')
                                : t('scaffold', 'postSize')}
                            </label>
                            {aiBimPreview.scaffoldType === 'wakugumi' ? (
                              <div className="space-y-1">
                                <select
                                  value={
                                    aiBimPreview.wakugumiFrameSeries ??
                                    wakugumiSeriesFromScaffoldWidthMm(aiBimPreview.dto.scaffoldWidthMm)
                                  }
                                  onChange={(e) => {
                                    const s = e.target.value as WakugumiFrameSeriesId;
                                    const width = scaffoldWidthMmFromWakugumiSeries(s);
                                    setAiBimPreview({
                                      ...aiBimPreview,
                                      wakugumiFrameSeries: s,
                                      frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
                                      dto: {
                                        ...aiBimPreview.dto,
                                        wakugumiFrameSeries: s,
                                        scaffoldWidthMm: width,
                                        frameSizeMm: WAKUGUMI_FIXED_FRAME_HEIGHT_MM,
                                      },
                                    });
                                  }}
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500 bg-white"
                                >
                                  {(rules?.wakugumi?.frameSeriesOptions ?? [
                                    { value: 'FT617' as const, label: 'FT-617', labelJp: 'FT-617' },
                                    { value: 'FT917' as const, label: 'FT-917', labelJp: 'FT-917' },
                                    { value: 'FT1217' as const, label: 'FT-1217', labelJp: 'FT-1217' },
                                  ]).map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {locale === 'ja' ? opt.labelJp : opt.label}
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[10px] text-gray-500 leading-tight">
                                  {t('scaffoldExtra', 'frameHeightFixed1700')}
                                </p>
                              </div>
                            ) : (
                              <select
                                value={aiBimPreview.dto.preferredMainTatejiMm ?? getAiBimDefaults().preferredMainTatejiMm}
                                onChange={(e) => {
                                  const h = Number(e.target.value) || getAiBimDefaults().preferredMainTatejiMm;
                                  setAiBimPreview({
                                    ...aiBimPreview,
                                    dto: { ...aiBimPreview.dto, preferredMainTatejiMm: h },
                                  });
                                }}
                                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500 bg-white"
                              >
                                {[1800, 2700, 3600].map((v) => (
                                  <option key={v} value={v}>
                                    {v}mm
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {aiBimPreview.obstacles && aiBimPreview.obstacles.length > 0 && (
                    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                      <span className="text-xs font-medium text-slate-600 block mb-1">{t('result', 'obstaclesDetected')}</span>
                      <p className="text-sm text-slate-800">
                        {aiBimPreview.obstacles.some((o) => o.type === 'balcony') && (
                          <>{t('result', 'balconyCount')} {aiBimPreview.obstacles.filter((o) => o.type === 'balcony').length} {t('result', 'placesUnit')}</>
                        )}
                        {aiBimPreview.obstacles.some((o) => o.type === 'ac') && (
                          <> · {t('result', 'acCount')} {aiBimPreview.obstacles.filter((o) => o.type === 'ac').length} {t('result', 'placesUnit')}</>
                        )}
                        {aiBimPreview.obstacles.some((o) => o.type === 'pillar') && (
                          <> · {t('result', 'pillarCount')} {aiBimPreview.obstacles.filter((o) => o.type === 'pillar').length} {t('result', 'placesUnit')}</>
                        )}
                        {aiBimPreview.obstacles.some((o) => o.type === 'door') && (
                          <> · {t('result', 'doorCount')} {aiBimPreview.obstacles.filter((o) => o.type === 'door').length} {t('result', 'placesUnit')} → {t('result', 'doorBeamNote')}</>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{t('result', 'obstacleNote')}</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-gray-500 block">
                      {t('scaffold', 'aiBimPreview3d')}
                    </span>
                    <Building3DPreview
                      outline={aiBimPreview.buildingOutline}
                      buildingHeightMm={aiBimPreview.buildingHeightMm}
                      wallLengthsMm={aiBimPreview.walls.map((w) => w.wallLengthMm)}
                      wallHeightsMm={
                        aiBimPreview.massingTiers?.length
                          ? undefined
                          : aiBimPreview.isStepped
                            ? aiBimPreview.walls.map((w) => w.wallHeightMm)
                            : undefined
                      }
                      massingTiers={aiBimPreview.massingTiers}
                      className="w-full rounded-lg border border-gray-200 bg-slate-50"
                      style={{ height: 320 }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={aiBimConfirming}
                    onClick={async () => {
                      if (!aiBimPreview) return;
                      setAiBimConfirming(true);
                      try {
                        const outline = aiBimPreview.buildingOutline;
                        // Auto-decompose walls for stepped/setback buildings.
                        // ONLY decompose when tiers have genuinely DIFFERENT footprints
                        // (setback/podium+tower). For simple L/U/T shapes where all walls
                        // have the same height (or heights differ but footprint is the same),
                        // skip decomposition to preserve the correct wall count.
                        let finalWalls = aiBimPreview.dto.walls;
                        if (aiBimPreview.massingTiers && aiBimPreview.massingTiers.length > 1) {
                          // Check if tiers have different footprint vertex counts
                          // (indicating genuinely different shapes, not just height zones)
                          const tierVertCounts = aiBimPreview.massingTiers.map(
                            (t: any) => Array.isArray(t.vertices) ? t.vertices.length : 0,
                          );
                          const hasDifferentFootprints = new Set(tierVertCounts.filter(c => c >= 3)).size > 1;
                          if (hasDifferentFootprints) {
                            const { decomposeTierWalls } = await import('@/lib/tier-wall-decomposer');
                            const decomposed = decomposeTierWalls(
                              aiBimPreview.dto.walls,
                              aiBimPreview.massingTiers,
                              aiBimPreview.buildingHeightMm,
                            );
                            if (decomposed.length > 0 && decomposed.length <= aiBimPreview.dto.walls.length * 3) {
                              finalWalls = decomposed;
                            }
                          }
                        }
                        // When walls have different heights (stepped building but same footprint),
                        // preserve per-wall heights from the preview without decomposing
                        if (aiBimPreview.isStepped && finalWalls === aiBimPreview.dto.walls) {
                          finalWalls = aiBimPreview.walls.map((pw) => ({
                            ...pw,
                            wallHeightMm: pw.wallHeightMm ?? aiBimPreview.buildingHeightMm,
                          }));
                        }
                        // Enforce minimum wall dimensions to prevent 0-level scaffold
                        // (can happen when AI returns pixel-scale coordinates instead of real mm)
                        const MIN_WALL_HEIGHT_MM = 1800;
                        const MIN_WALL_LENGTH_MM = 600;
                        const sanitizedWalls = finalWalls.map((w) => ({
                          ...w,
                          wallHeightMm: Math.max(w.wallHeightMm ?? aiBimPreview.buildingHeightMm, MIN_WALL_HEIGHT_MM),
                          wallLengthMm: Math.max(w.wallLengthMm, MIN_WALL_LENGTH_MM),
                        }));
                        // Only include massingTiers in DTO when walls were actually decomposed.
                        // When decomposition was skipped (same footprint tiers), strip them
                        // to prevent the 3D view from creating erroneous tier groups.
                        const wallsWereDecomposed = finalWalls !== aiBimPreview.dto.walls && finalWalls !== aiBimPreview.walls;
                        const dtoBase = { ...aiBimPreview.dto };
                        if (!wallsWereDecomposed) {
                          delete (dtoBase as any).massingTiers;
                        }
                        const dto = {
                          ...dtoBase,
                          walls: sanitizedWalls,
                          siteName: '',
                          siteAddress: '',
                          siteEmail: '',
                          sitePhone: '',
                          siteFax: '',
                          pattankoCornerCount: outline && outline.length >= 3 ? countPattankoCorners(outline) : undefined,
                        };
                        const data = await scaffoldConfigsApi.createAndCalculate(dto);
                        router.push(`/scaffold/${data.config.id}?aiBim=1`);
                      } catch (err: any) {
                        setAiBimError(err?.message ?? t('scaffold', 'aiBimCreateFailed'));
                        setAiBimConfirming(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50"
                  >
                    {aiBimConfirming ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                    {aiBimConfirming ? t('scaffold', 'aiBimCreating') : t('scaffold', 'aiBimCreateScaffold')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          CAD DRAWING MODE — Manual plan drawing with polyline/dimension
         ═══════════════════════════════════════════════════════ */}
      {inputMode === 'cad_draw' && !editConfigId && (
        <div className="max-w-[1800px] mx-auto px-4 pb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <PenTool className="h-5 w-5 text-emerald-600" />
              {t('scaffoldExtra', 'cadDrawTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              {t('scaffoldExtra', 'cadDrawDescription')}
            </p>
            <CadDrawingCanvas
              buildingHeightMm={buildingHeightMm ?? 3000}
              onBuildingHeightChange={(h) => setBuildingHeightMm(h)}
              onComplete={(result) => {
                const mapped: WallState[] = result.walls.map((w, i) => ({
                  side: w.side,
                  enabled: true,
                  lengthMm: w.wallLengthMm,
                  heightMm: w.wallHeightMm,
                  stairAccessCount: w.stairAccessCount,
                  kaidanCount: 0,
                  kaidanOffsets: [],
                  isMultiSegment: false,
                  segments: [{ lengthMm: w.wallLengthMm, offsetMm: 0 }],
                  cfNote: '',
                }));
                setWalls(mapped);
                setBuildingHeightMm(result.buildingHeightMm);
                setPolygonVertices(
                  result.vertices.map((v) => ({ x: v.xFrac, y: v.yFrac })),
                );
                setPrefilled(true);
                setInputMode('drawing');
                setPendingInputUiPath('cad_draw');
              }}
              className="w-full"
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          MANUAL INPUT — Drawing Upload + Quick Shape Builder
         ═══════════════════════════════════════════════════════ */}
      {((inputMode !== 'ai_extract' && inputMode !== 'cad_draw') || editConfigId) &&
        (canFile || canQuick || !!editConfigId) && (<>
      {/* Sub-tab selector (disabled while editing an existing config) */}
      {(canFile || canQuick) && (
      <div className="max-w-[1600px] mx-auto px-4 mb-4">
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          {canFile && (
          <button
            type="button"
            disabled={!!editConfigId}
            onClick={() => {
              if (editConfigId) return;
              setManualSubTab('drawing');
              setInputMode('drawing');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
              manualSubTab === 'drawing'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <PenTool className="h-3.5 w-3.5" />
            {t('scaffoldExtra', 'drawingUpload')}
          </button>
          )}
          {canQuick && (
          <button
            type="button"
            disabled={!!editConfigId}
            onClick={() => {
              if (editConfigId) return;
              setManualSubTab('quick');
              setInputMode('quick');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
              manualSubTab === 'quick'
                ? 'bg-white text-green-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            {t('scaffoldExtra', 'quickBuilder')}
          </button>
          )}
        </div>
      </div>
      )}

      {/* Quick Shape Builder */}
      {manualSubTab === 'quick' && !editConfigId && canQuick && (
        <div className="max-w-[1200px] mx-auto px-4 pb-8">
          <QuickShapeBuilder
            onSubmit={handleQuickShapeSubmit}
            isCalculating={calculateMutation.isPending}
          />
          {calculateMutation.isError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mt-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="text-red-700 text-sm">{t('scaffold', 'calcError')}</div>
            </div>
          )}
        </div>
      )}

      {/* Drawing Upload (+ edit hints when upload UI is skipped) */}
      {(manualSubTab === 'drawing' || editConfigId) && (<>
      {editConfigId && savedUiInputPath === 'quick' && (
        <div className="max-w-[1600px] mx-auto px-4 mb-4 rounded-lg border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
          {t('scaffold', 'editFromQuickHint')}
        </div>
      )}
      {editConfigId && savedUiInputPath === 'ai_extract' && (
        <div className="max-w-[1600px] mx-auto px-4 mb-4 rounded-lg border border-violet-200 bg-violet-50/90 p-4 text-sm text-violet-950">
          {t('scaffold', 'editFromAiHint')}
        </div>
      )}
      {showDrawingUpload &&
        subscriptionInfo?.status === 'trialing' &&
        subscriptionInfo.trialFileUploads && (
          <div className="max-w-[1600px] mx-auto px-4 mb-3">
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t('billing', 'trialFileUploadsRemaining')
                .replace('{used}', String(subscriptionInfo.trialFileUploads.used))
                .replace('{max}', String(subscriptionInfo.trialFileUploads.max))}
            </p>
          </div>
        )}
      {showDrawingUpload && (
        <div className="max-w-[1600px] mx-auto px-4 mb-6">
          <DrawingUpload
            perimeterModel={perimeterModel}
            onWallsDetected={handleWallsDetected}
            onSegmentEdit={handleSegmentEdit}
            externalWallLengths={walls.map(w => w.lengthMm)}
            buildingHeightMm={buildingHeightMm}
            onBuildingHeightChange={setBuildingHeightMm}
            buildingHeightLabel={t('scaffold', 'defaultHeightForDrawingMm')}
            buildingHeightHint={t('scaffold', 'defaultHeightDrawingHint')}
            wallHeightsMm={walls.map((w) => w.heightMm)}
            onWallHeightMmChange={(edgeIdx, mm) => updateWall(edgeIdx, { heightMm: mm })}
            wallCfNotes={walls.map((w) => w.cfNote ?? '')}
            onWallCfNoteChange={(edgeIdx, note) => updateWall(edgeIdx, { cfNote: note })}
            allowAiPoweredFileParsing={canAi}
          />
        </div>
      )}

      </>)}

      {/* ═══════════════════════════════════════════════════════
          WALL CONFIG + CALCULATE (shown when walls exist)
         ═══════════════════════════════════════════════════════ */}
      {walls.length > 0 && (
        <div className="max-w-[1600px] mx-auto px-4 pb-8">

        {/* Wall Configuration */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('scaffold', 'wallConfig')}</h2>
          <p className="text-sm text-gray-600 mb-3">
            {t('scaffold', 'perWallConfigMetersHint') || 'Lengths and heights are in meters. Use the drawing panel for edge details.'}
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">
                {t('scaffold', 'wallSettingsLabel')}
              </p>
              {walls.map((wall, i) => (
                <div
                  key={wall.side}
                  onClick={() => setSelectedWallIdx(i)}
                  className={`rounded-lg border p-3 transition-all cursor-pointer ${
                    selectedWallIdx === i
                      ? 'ring-2 ring-orange-300 border-orange-200 bg-orange-50/40'
                      : wall.enabled
                        ? 'border-blue-200 bg-blue-50/50'
                        : 'border-gray-200 bg-gray-50 opacity-60'
                  }`}
                >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={wall.enabled}
                      onChange={(e) => updateWall(i, { enabled: e.target.checked })}
                      className="h-3.5 w-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="font-semibold text-gray-800">{wallChordAt(i)}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 whitespace-nowrap">{t('scaffold', 'scaffoldWidth')}</span>
                    <select
                      value={wall.scaffoldWidthMm ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateWall(i, { scaffoldWidthMm: v ? Number(v) : undefined });
                      }}
                      disabled={!wall.enabled}
                      className="w-[4.5rem] rounded border border-gray-300 px-1.5 py-1 text-xs focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="">{scaffoldWidthMm}mm</option>
                      {[600, 900, 1200].filter((w) => w !== scaffoldWidthMm).map((w) => (
                        <option key={w} value={w}>{w}mm</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 whitespace-nowrap">{t('scaffold', 'stairsPerSide')}</span>
                    <select
                      value={wall.stairAccessCount ?? 0}
                      onChange={(e) => {
                        const n = Number(e.target.value) || 0;
                        const effLen =
                          wall.isMultiSegment && wall.segments.length > 0
                            ? calcTotalFromSegments(wall.segments)
                            : wall.lengthMm;
                        const offsets =
                          n <= 0 || effLen <= 0
                            ? []
                            : Array.from({ length: n }, (_, j) => {
                                const p = Math.round((effLen / (n + 1)) * (j + 1));
                                return Math.min(effLen, Math.round(p / 100) * 100);
                              });
                        updateWall(i, { stairAccessCount: n, kaidanCount: n, kaidanOffsets: offsets });
                      }}
                      disabled={!wall.enabled}
                      className="w-14 rounded border border-gray-300 px-1 py-1 text-xs focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {[0, 1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-gray-500 whitespace-nowrap">{t('scaffold', 'wallLength')}</label>
                    <input
                      type="number"
                      min={0.6}
                      step={0.01}
                      value={(() => {
                        const mm =
                          wall.isMultiSegment && wall.segments.length > 0
                            ? calcTotalFromSegments(wall.segments)
                            : wall.lengthMm;
                        return mm > 0 ? Math.round(mm) / 1000 : '';
                      })()}
                      onChange={(e) => {
                        if (wall.isMultiSegment) return;
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v <= 0) return;
                        updateWall(i, { lengthMm: Math.round(v * 1000) });
                      }}
                      disabled={!wall.enabled || wall.isMultiSegment}
                      readOnly={wall.isMultiSegment}
                      className={`w-[4.25rem] rounded border px-1.5 py-1 text-xs focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${
                        wall.isMultiSegment ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-gray-300'
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-xs text-gray-400">m</span>
                    {wall.isMultiSegment && (
                      <span className="text-[10px] text-orange-600" title="From segments">Σ</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-gray-500 whitespace-nowrap">{t('scaffold', 'wallHeight')}</label>
                    <input
                      type="number"
                      min={1}
                      step={0.01}
                      value={wall.heightMm > 0 ? Math.round(wall.heightMm) / 1000 : ''}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v <= 0) return;
                        updateWall(i, { heightMm: Math.round(v * 1000) });
                      }}
                      disabled={!wall.enabled}
                      className="w-[4.25rem] rounded border border-gray-300 px-1.5 py-1 text-xs focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-xs text-gray-400">m</span>
                  </div>
                  {!wall.scaffoldWidthMm && (
                    <span className="text-[10px] text-gray-400">{t('scaffold', 'defaultScaffoldWidthTag')}{scaffoldWidthMm}mm</span>
                  )}
                </div>

                {/* Multi-Segment Wall Editor */}
                {wall.enabled && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={wall.isMultiSegment}
                          onChange={(e) => {
                            const multi = e.target.checked;
                            if (multi && wall.segments.length === 0) {
                              updateWall(i, {
                                isMultiSegment: true,
                                segments: [{ lengthMm: wall.lengthMm || 5000, offsetMm: 0 }],
                              });
                            } else {
                              updateWall(i, { isMultiSegment: multi });
                              if (!multi && wall.segments.length > 0) {
                                updateWall(i, {
                                  isMultiSegment: false,
                                  lengthMm: calcTotalFromSegments(wall.segments),
                                });
                              }
                            }
                          }}
                          className="h-3.5 w-3.5 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
                        />
                        <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
                          <LayoutList className="h-3.5 w-3.5" />
                          {t('scaffoldExtra', 'multiSegmentWall')}
                        </span>
                      </label>
                      {wall.isMultiSegment && (
                        <span className="text-xs text-orange-600 font-medium ml-auto">
                          Total: {calcTotalFromSegments(wall.segments).toLocaleString()}mm
                          {wall.segments.length > 1 && (
                            <span className="text-gray-400 ml-1">
                              ({wall.segments.length} segments + {
                                  wall.segments.reduce(
                                    (sum, _, idx) =>
                                      idx > 0
                                        ? sum + Math.abs(wall.segments[idx].offsetMm - wall.segments[idx - 1].offsetMm)
                                        : sum,
                                    0,
                                ).toLocaleString()
                              }mm returns)
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {wall.isMultiSegment && (
                      <div className="space-y-2 ml-4">
                        {wall.segments.length > 1 && (
                          <div className="bg-gray-100 rounded-lg p-2 mb-2">
                              <svg
                                viewBox={`0 0 ${Math.max(200, wall.segments.reduce((s, seg) => s + seg.lengthMm, 0) / 50)} 80`}
                                className="w-full h-12"
                                preserveAspectRatio="xMidYMid meet"
                              >
                              {(() => {
                                const scale = 1 / 50;
                                let segX = 0;
                                  const maxOffset = Math.max(...wall.segments.map((s) => Math.abs(s.offsetMm)));
                                const oScale = maxOffset > 0 ? 25 / maxOffset : 1;
                                const baseline = 50;
                                const rects: JSX.Element[] = [];
                                wall.segments.forEach((seg, idx) => {
                                  const w = seg.lengthMm * scale;
                                  const segY = baseline - seg.offsetMm * oScale;
                                  rects.push(
                                      <rect
                                        key={`seg-${idx}`}
                                        x={segX}
                                        y={segY - 4}
                                        width={w}
                                        height={8}
                                        fill="#f97316"
                                        opacity={0.7}
                                        rx={1}
                                      />,
                                  );
                                  if (idx > 0) {
                                    const prevY = baseline - wall.segments[idx - 1].offsetMm * oScale;
                                    rects.push(
                                        <line
                                          key={`ret-${idx}`}
                                          x1={segX}
                                          y1={prevY}
                                          x2={segX}
                                          y2={segY}
                                          stroke="#9ca3af"
                                          strokeWidth={1.5}
                                          strokeDasharray="3,2"
                                        />,
                                    );
                                  }
                                  segX += w;
                                });
                                return rects;
                              })()}
                            </svg>
                          </div>
                        )}

                        {wall.segments.map((seg, segIdx) => (
                            <div
                              key={segIdx}
                              className="flex items-center gap-2 bg-orange-50 rounded-lg px-3 py-2 border border-orange-200"
                            >
                              <span className="text-xs font-medium text-orange-700 w-6">{segIdx + 1}.</span>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-gray-600">L:</label>
                              <input
                                type="number"
                                value={seg.lengthMm || ''}
                                onChange={(e) => {
                                  const newSegs = [...wall.segments];
                                  newSegs[segIdx] = { ...newSegs[segIdx], lengthMm: Number(e.target.value) || 0 };
                                  const total = calcTotalFromSegments(newSegs);
                                  updateWall(i, { segments: newSegs, lengthMm: total });
                                }}
                                placeholder="5000"
                                className="w-24 rounded border border-orange-300 px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500"
                                min={600}
                                step={100}
                              />
                              <span className="text-xs text-gray-400">mm</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-gray-600">Offset:</label>
                              <input
                                type="number"
                                value={seg.offsetMm}
                                onChange={(e) => {
                                  const newSegs = [...wall.segments];
                                  newSegs[segIdx] = { ...newSegs[segIdx], offsetMm: Number(e.target.value) || 0 };
                                  const total = calcTotalFromSegments(newSegs);
                                  updateWall(i, { segments: newSegs, lengthMm: total });
                                }}
                                placeholder="0"
                                className="w-20 rounded border border-orange-300 px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500"
                                step={100}
                              />
                              <span className="text-xs text-gray-400">mm</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newSegs = wall.segments.filter((_, k) => k !== segIdx);
                                const total = calcTotalFromSegments(newSegs);
                                updateWall(i, { segments: newSegs, lengthMm: total });
                              }}
                              className="ml-auto p-1 text-red-400 hover:text-red-600 disabled:opacity-30"
                              disabled={wall.segments.length <= 1}
                              title="Remove segment"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => {
                              const lastOffset =
                                wall.segments.length > 0
                              ? wall.segments[wall.segments.length - 1].offsetMm
                              : 0;
                            const newSegs = [...wall.segments, { lengthMm: 3000, offsetMm: lastOffset }];
                            const total = calcTotalFromSegments(newSegs);
                            updateWall(i, { segments: newSegs, lengthMm: total });
                          }}
                          className="flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-800 font-medium px-3 py-1.5 rounded-lg border border-dashed border-orange-300 hover:bg-orange-50 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {t('scaffoldExtra', 'addSegment')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            </div>

            <div className="lg:sticky lg:top-4 self-start">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-gray-800">2D Plan</div>
                  {selectedWallIdx != null && (
                    <div className="text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-md px-2 py-1">
                      {wallChordAt(selectedWallIdx)}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  Click a wall row to highlight it.
                </div>
                {footprintForPreview && footprintForPreview.length >= 3 ? (
                  <FootprintMiniPreview
                    vertices={footprintForPreview}
                    labels={walls.map((_, i) => wallChordAt(i))}
                    activeIndex={selectedWallIdx}
                  />
                ) : (
                  <div className="text-xs text-gray-500 rounded-lg border border-dashed border-gray-300 p-4">
                    Upload a drawing and detect the outline first.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <BuildingScaffoldSettingsPanel
          showSiteContact={false}
          rules={rules}
          buildingHeightMm={buildingHeightMm}
          setBuildingHeightMm={setBuildingHeightMm}
          scaffoldType={scaffoldType}
          setScaffoldType={setScaffoldType}
          structureType={structureType}
          setStructureType={setStructureType}
          scaffoldWidthMm={scaffoldWidthMm}
          setScaffoldWidthMm={setScaffoldWidthMm}
          wakugumiFrameSeries={wakugumiFrameSeries}
          setWakugumiFrameSeries={setWakugumiFrameSeries}
          preferredMainTatejiMm={preferredMainTatejiMm}
          setPreferredMainTatejiMm={setPreferredMainTatejiMm}
          habakiCountPerSpan={habakiCountPerSpan}
          setHabakiCountPerSpan={setHabakiCountPerSpan}
          endStopperType={endStopperType}
          setEndStopperType={setEndStopperType}
          setFrameSizeMm={setFrameSizeMm}
        />

        <VertexCornerKindsPanel
          wallCount={walls.length}
          closedFootprint={closedFootprintChords}
          useManual={cornerKindsUseManual}
          onUseManualChange={(v) => {
            setCornerKindsUseManual(v);
            if (v) {
              if (footprintForPreview && footprintForPreview.length === walls.length) {
                setVertexCornerKinds(inferVertexCornerKindsFromPolygonMm(footprintForPreview));
              } else {
                setVertexCornerKinds((prev) => {
                  const n = walls.length;
                  const next = prev.slice(0, n);
                  while (next.length < n) next.push('convex');
                  return next;
                });
              }
            }
          }}
          kinds={vertexCornerKinds}
          onKindChange={(vi, k) => {
            setVertexCornerKinds((prev) => {
              const n = walls.length;
              const next = prev.length === n ? [...prev] : Array.from({ length: n }, (_, i) => prev[i] ?? 'convex');
              next[vi] = k;
              return next;
            });
          }}
          onInferFromShape={() => {
            if (footprintForPreview && footprintForPreview.length === walls.length) {
              setVertexCornerKinds(inferVertexCornerKindsFromPolygonMm(footprintForPreview));
            }
          }}
        />

        {/* Error message */}
        {calculateMutation.isError && (() => {
          const err = calculateMutation.error as Error & { code?: string; response?: { status?: number } };
          const isNetworkError =
            err?.code === 'ERR_NETWORK' ||
            err?.message === 'Network Error' ||
            (err?.message && String(err.message).toLowerCase().includes('network'));
          return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="text-red-700 text-sm">
                {isNetworkError ? (
                  <span>{t('scaffold', 'networkError')}</span>
                ) : (
                  <>
                    <span>{t('scaffold', 'calcError')}</span>
                    {err?.message && (
                      <span className="block mt-1 text-red-500">{err.message}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Calculate Button */}
        <button
          onClick={handleCalculate}
          disabled={calculateMutation.isPending || walls.filter((w) => w.enabled).length === 0}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-3 text-lg shadow-lg"
        >
          {calculateMutation.isPending ? (
            <span className="flex items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>{t('scaffold', 'calculating')}</span>
            </span>
          ) : (
            <span className="flex items-center gap-3">
              <Calculator className="h-6 w-6" />
              <span>{t('scaffold', 'calcButton')}</span>
              <ArrowRight className="h-5 w-5" />
            </span>
          )}
        </button>
      </div>
      )}
      </>)}
    </div>
  );
}
