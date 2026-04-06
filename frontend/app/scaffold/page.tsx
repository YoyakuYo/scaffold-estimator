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
  type EdgeHashiraLabeling,
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
  FileText,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  QuickShapeBuilder,
  type QuickShapeConfig,
  type QuickShapeBuilderDraft,
} from '@/components/quick-shape-builder';
import {
  visionBimApi,
  type IfcPremiumMetadata,
  type PremiumScheduleImportResult,
  type VisionFootprintResult,
  type VisionMassingTier,
} from '@/lib/api/vision-bim';
import { ScaffoldManager } from '@/lib/scaffold-manager';
import { getAiBimDefaults } from '@/lib/ai-bim-rules';
import {
  extractBimFacadeColorsFromImageFile,
  isRasterImageUpload,
} from '@/lib/bim-facade-colors';
import { computeBimPreviewPlanToM } from '@/lib/bim-preview-plan-coords';
import { synthesizeMassingTiersFromWallHeights } from '@/lib/synthesize-massing-tiers-from-wall-heights';
import { BuildingScaffoldSettingsPanel } from '@/components/scaffold/building-scaffold-settings-panel';
import {
  edgeChordName,
  formRowsFromWallCount,
  formRowsFromStoredLabeling,
  labelingForEnabledWallIndices,
  type EdgeHashiraFormRow,
} from '@/lib/edge-hashira-labels';
import {
  normalizeScaffoldWallCfKey,
  SCAFFOLD_WALL_CF_KEYS,
  type ScaffoldWallCfKey,
} from '@/lib/scaffold-wall-cf-options';
import { EDGE_HASHIRA_STATION_SELECT_MAX } from '@/lib/edge-hashira-labels';
import {
  SCAFFOLD_WIZARD_DRAFT_KEY,
  WIZARD_DRAFT_MAX_AGE_MS,
  WIZARD_DRAFT_SAVE_VERSION,
} from '@/lib/scaffold-wizard-draft-storage';
import { footprintVerticesForWallPreview } from '@/lib/footprint-preview';
import { inferEdgePlanAxisFromVertices } from '@/lib/infer-edge-plan-axis';
import { buildQuickShapeFootprintMm } from '@/lib/quick-shape-footprint';
import { zoomPanViewBox } from '@/lib/svg-view-box-zoom';
import { PreviewZoomToolbar } from '@/components/scaffold/preview-zoom-toolbar';
import { formatMmAsMetersLabel, formatMmLabel, mToMm, mmToM } from '@/lib/dimension-meters';
import { inferVertexCornerKindsFromPolygonMm } from '@/lib/corner-kinds';
import { VertexCornerKindsPanel } from '@/components/scaffold/vertex-corner-kinds-panel';
import type { ScaffoldWidthCatalogMm } from '@/lib/scaffold-width-catalog';
import {
  normalizeScaffoldWidthMmToCatalog,
  SCAFFOLD_WIDTH_CATALOG_MM,
  SCAFFOLD_WIDTH_NARROW_MM,
} from '@/lib/scaffold-width-catalog';

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

const HASHIRA_STATION_OPTIONS = Array.from(
  { length: EDGE_HASHIRA_STATION_SELECT_MAX },
  (_, i) => i + 1,
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
  /** Per-wall CF dropdown key (drawing panel); see scaffold-wall-cf-options; not sent to calculation API. */
  cfNote?: string;
  /** Plan run for this edge: axis (X or Y) and signed run in mm (drawing panel). */
  edgePlanAxis?: 'X' | 'Y';
  edgePlanAxisMm?: number;
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

function scaffoldWidthMmFromWakugumiSeries(s: WakugumiFrameSeriesId): ScaffoldWidthCatalogMm {
  if (s === 'FT617') return 610;
  if (s === 'FT917') return 914;
  return 1219;
}

function wakugumiSeriesFromScaffoldWidthMm(w: number): WakugumiFrameSeriesId {
  const n = normalizeScaffoldWidthMmToCatalog(w);
  if (n === 610) return 'FT617';
  if (n === 914) return 'FT917';
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
  viewZoom = 1,
  viewPan = { x: 0, y: 0 },
}: {
  outline: Array<{ xFrac: number; yFrac: number }>;
  wallLengthsMm?: number[];
  className?: string;
  viewZoom?: number;
  viewPan?: { x: number; y: number };
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
  const baseVb = { x: -0.1, y: -0.1, w: 1.2, h: 1.2 };
  const vb = zoomPanViewBox(baseVb, viewZoom, viewPan);
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
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
  const pts = buildQuickShapeFootprintMm(config.shapeType, config.sides);
  if (pts.length < 3) return { vertices: [] };
  return { vertices: pts.map((p) => ({ xFrac: p.x, yFrac: p.y })) };
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

/** Matches session shape of `aiBimPreview` state on the scaffold wizard. */
type AiBimWizardPreview = {
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
  /** Present when last extraction was from IFC (Premium semantic metadata). */
  ifcPremiumMetadata?: IfcPremiumMetadata;
  /** Last applied Premium schedule import (optional). */
  premiumScheduleLast?: PremiumScheduleImportResult;
};

function applyPremiumScheduleToAiPreview(
  preview: AiBimWizardPreview,
  schedule: PremiumScheduleImportResult,
): AiBimWizardPreview {
  const n = preview.walls.length;
  const closed = n >= 3;
  if (schedule.wallLengthsMm.length !== n) {
    throw new Error(
      `Wall count mismatch: building has ${n} edges but schedule has ${schedule.wallLengthsMm.length}.`,
    );
  }

  const labelMap =
    schedule.edgeLabels && schedule.edgeLabels.length === schedule.wallLengthsMm.length
      ? new Map(
          schedule.edgeLabels.map((lbl, i) => [lbl.toUpperCase(), schedule.wallLengthsMm[i]!] as const),
        )
      : null;

  const lengths: number[] = [];
  if (labelMap && labelMap.size > 0) {
    for (let i = 0; i < n; i++) {
      const chord = edgeChordName(i, n, closed).toUpperCase();
      const mm = labelMap.get(chord);
      if (mm == null) {
        throw new Error(
          `Schedule has no length for wall ${chord}. Use CSV/JSON rows for every chord shown in the table.`,
        );
      }
      lengths.push(mm);
    }
  } else {
    for (let i = 0; i < n; i++) lengths.push(schedule.wallLengthsMm[i]!);
  }

  const newWalls = preview.walls.map((w, i) => ({
    ...w,
    wallLengthMm: Math.max(600, lengths[i]!),
  }));

  return {
    ...preview,
    walls: newWalls,
    wallLengthsFromDimText: true,
    dto: { ...preview.dto, walls: newWalls },
    premiumScheduleLast: schedule,
  };
}

interface RawWizardDraft {
  v?: number;
  savedAt?: number;
  walls?: WallState[];
  polygonVertices?: Array<{ x: number; y: number }>;
  hashiraRows?: EdgeHashiraFormRow[];
  buildingHeightMm?: number | null;
  scaffoldWidthMm?: number;
  inputMode?: string;
  manualSubTab?: string;
  prefilled?: boolean;
  pendingInputUiPath?: CreateScaffoldConfigDto['inputUiPath'] | null;
  quickShapeDraft?: QuickShapeBuilderDraft;
  aiBimPreview?: AiBimWizardPreview;
  aiBimEdgeHashira?: EdgeHashiraFormRow[];
  aiBimEdgeCf?: string[];
}

interface WizardSessionBootstrap {
  inputMode: 'drawing' | 'quick' | 'ai_extract' | 'cad_draw';
  manualSubTab: 'drawing' | 'quick';
  walls: WallState[];
  polygonVertices: Array<{ x: number; y: number }>;
  hashiraRows: EdgeHashiraFormRow[];
  buildingHeightMm: number | null;
  prefilled: boolean;
  pendingInputUiPath: CreateScaffoldConfigDto['inputUiPath'] | null;
  scaffoldWidthMm: number;
  quickShapeDraft: QuickShapeBuilderDraft | null;
  aiBimPreview: AiBimWizardPreview | null;
  aiBimEdgeHashira: EdgeHashiraFormRow[];
  aiBimEdgeCf: ScaffoldWallCfKey[];
}

function wizardSessionDefaults(): WizardSessionBootstrap {
  return {
    inputMode: 'drawing',
    manualSubTab: 'drawing',
    walls: [],
    polygonVertices: [],
    hashiraRows: [],
    buildingHeightMm: null,
    prefilled: false,
    pendingInputUiPath: null,
    scaffoldWidthMm: SCAFFOLD_WIDTH_NARROW_MM,
    quickShapeDraft: null,
    aiBimPreview: null,
    aiBimEdgeHashira: [],
    aiBimEdgeCf: [],
  };
}

function bootstrapWizardFromSession(editConfigId: string | null): WizardSessionBootstrap {
  const d = wizardSessionDefaults();
  if (typeof window === 'undefined' || editConfigId) return d;
  try {
    const raw = sessionStorage.getItem(SCAFFOLD_WIZARD_DRAFT_KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as RawWizardDraft;
    if (parsed.v !== WIZARD_DRAFT_SAVE_VERSION) {
      sessionStorage.removeItem(SCAFFOLD_WIZARD_DRAFT_KEY);
      return d;
    }
    if (
      typeof parsed.savedAt !== 'number' ||
      Number.isNaN(parsed.savedAt) ||
      Date.now() - parsed.savedAt > WIZARD_DRAFT_MAX_AGE_MS
    ) {
      sessionStorage.removeItem(SCAFFOLD_WIZARD_DRAFT_KEY);
      return d;
    }

    let mode: WizardSessionBootstrap['inputMode'] =
      parsed.inputMode === 'ai_extract' ||
      parsed.inputMode === 'cad_draw' ||
      parsed.inputMode === 'quick' ||
      parsed.inputMode === 'drawing'
        ? parsed.inputMode
        : 'drawing';
    let mtab: WizardSessionBootstrap['manualSubTab'] =
      parsed.manualSubTab === 'quick' ? 'quick' : 'drawing';
    if (mtab === 'quick') mode = 'quick';
    if (mode === 'quick') mtab = 'quick';

    d.inputMode = mode;
    d.manualSubTab = mtab;

    const hasWalls = Array.isArray(parsed.walls) && parsed.walls.length > 0;

    if (mode === 'ai_extract') {
      d.walls = [];
      d.polygonVertices = [];
      d.hashiraRows = [];
      if (parsed.aiBimPreview) d.aiBimPreview = parsed.aiBimPreview;
      if (Array.isArray(parsed.aiBimEdgeHashira)) d.aiBimEdgeHashira = parsed.aiBimEdgeHashira;
      if (Array.isArray(parsed.aiBimEdgeCf)) {
        d.aiBimEdgeCf = parsed.aiBimEdgeCf.map((x) => normalizeScaffoldWallCfKey(String(x)));
      }
    } else {
      if (hasWalls) {
        d.walls = parsed.walls!;
        d.polygonVertices = Array.isArray(parsed.polygonVertices) ? parsed.polygonVertices : [];
        d.hashiraRows = Array.isArray(parsed.hashiraRows) ? parsed.hashiraRows : [];
      }
      if (mode === 'quick' && parsed.quickShapeDraft) {
        d.quickShapeDraft = parsed.quickShapeDraft;
      }
    }

    if (parsed.buildingHeightMm !== undefined) d.buildingHeightMm = parsed.buildingHeightMm;
    if (typeof parsed.prefilled === 'boolean') d.prefilled = parsed.prefilled;
    if (parsed.pendingInputUiPath !== undefined) d.pendingInputUiPath = parsed.pendingInputUiPath ?? null;
    if (typeof parsed.scaffoldWidthMm === 'number') {
      d.scaffoldWidthMm = normalizeScaffoldWidthMmToCatalog(parsed.scaffoldWidthMm);
    }

    return d;
  } catch {
    return wizardSessionDefaults();
  }
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
  const editConfigId = searchParams.get('edit') ?? null;
  const initialWizard = useMemo(() => bootstrapWizardFromSession(editConfigId), [editConfigId]);

  // ─── Input Mode ────────────────────────────────────────
  const [inputMode, setInputMode] = useState<'drawing' | 'quick' | 'ai_extract' | 'cad_draw'>(() => initialWizard.inputMode);
  const [manualSubTab, setManualSubTab] = useState<'drawing' | 'quick'>(() => initialWizard.manualSubTab);
  /** First calculate after CAD complete — tag config as cad_draw until saved */
  const [pendingInputUiPath, setPendingInputUiPath] = useState<CreateScaffoldConfigDto['inputUiPath'] | null>(
    () => initialWizard.pendingInputUiPath,
  );
  const [aiBimUploading, setAiBimUploading] = useState(false);
  const [aiBimError, setAiBimError] = useState<string | null>(null);
  const [premiumScheduleError, setPremiumScheduleError] = useState<string | null>(null);
  const [premiumScheduleInfo, setPremiumScheduleInfo] = useState<string | null>(null);
  /** After AI extract: show for double-check before creating config. */
  const [aiBimPreview, setAiBimPreview] = useState<AiBimWizardPreview | null>(() => initialWizard.aiBimPreview);
  const [aiBimConfirming, setAiBimConfirming] = useState(false);
  /** Snapshot of AI-extracted footprint for compare / reset (mm polygon, same as buildingOutline). */
  const [aiBimExtractOutline, setAiBimExtractOutline] = useState<FootprintPoint[] | null>(null);
  const [aiBimCompareExtract, setAiBimCompareExtract] = useState(false);
  const [aiFootprintPreviewZoom, setAiFootprintPreviewZoom] = useState(1);
  const [aiFootprintPreviewPan, setAiFootprintPreviewPan] = useState({ x: 0, y: 0 });
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
  const [scaffoldWidthMm, setScaffoldWidthMm] = useState(() => initialWizard.scaffoldWidthMm);
  // Kusabi-specific
  const [preferredMainTatejiMm, setPreferredMainTatejiMm] = useState(1800);
  // Wakugumi-specific
  const [frameSizeMm, setFrameSizeMm] = useState(1700);
  const [wakugumiFrameSeries, setWakugumiFrameSeries] = useState<WakugumiFrameSeriesId>('FT917');
  const [habakiCountPerSpan, setHabakiCountPerSpan] = useState(2);
  const [endStopperType, setEndStopperType] = useState<'nuno' | 'frame'>('nuno');
  const [walls, setWalls] = useState<WallState[]>(() => initialWizard.walls);
  const [buildingHeightMm, setBuildingHeightMm] = useState<number | null>(() => initialWizard.buildingHeightMm);
  const [polygonVertices, setPolygonVertices] = useState<Array<{ x: number; y: number }>>(
    () => initialWizard.polygonVertices,
  );
  const [selectedWallIdx, setSelectedWallIdx] = useState<number | null>(null);
  const [prefilled, setPrefilled] = useState(() => initialWizard.prefilled);
  /** Live CAD footprint (mm) for 2D preview while drawing */
  const [cadLiveFootprintMm, setCadLiveFootprintMm] = useState<Array<{ x: number; y: number }> | null>(
    null,
  );
  const [cadLiveFootprintClosed, setCadLiveFootprintClosed] = useState(false);
  const [cornerKindsUseManual, setCornerKindsUseManual] = useState(false);
  const [vertexCornerKinds, setVertexCornerKinds] = useState<Array<'convex' | 'reflex'>>([]);
  const [hashiraRows, setHashiraRows] = useState<EdgeHashiraFormRow[]>(() => initialWizard.hashiraRows);
  const [aiBimEdgeHashira, setAiBimEdgeHashira] = useState<EdgeHashiraFormRow[]>(
    () => initialWizard.aiBimEdgeHashira,
  );
  const [aiBimEdgeCf, setAiBimEdgeCf] = useState<ScaffoldWallCfKey[]>(() => initialWizard.aiBimEdgeCf);
  const [quickShapeDraft, setQuickShapeDraft] = useState<QuickShapeBuilderDraft | null>(
    () => initialWizard.quickShapeDraft,
  );
  const handleQuickShapeDraftChange = useCallback((next: QuickShapeBuilderDraft) => {
    setQuickShapeDraft(next);
  }, []);

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
    const baseW = normalizeScaffoldWidthMmToCatalog(editConfig.scaffoldWidthMm ?? SCAFFOLD_WIDTH_NARROW_MM);
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
    const rawPoly = editConfig.calculationResult?.polygonVertices;
    const editPolyMm =
      Array.isArray(rawPoly) && rawPoly.length >= 3
        ? rawPoly.map((p: { x?: number; y?: number; xFrac?: number; yFrac?: number }) => ({
            x: p.x ?? p.xFrac ?? 0,
            y: p.y ?? p.yFrac ?? 0,
          }))
        : null;

    const wallList = editConfig.walls ?? [];
    if (wallList.length > 0) {
      const buildingH = editConfig.buildingHeightMm ?? 3000;
      const closedLoop = wallList.length >= 3;
      const mapped: WallState[] = wallList.map((w: any, wi: number) => {
        const segs = w.segments && Array.isArray(w.segments) ? w.segments : [];
        const isMulti = segs.length > 0;
        const lengthMm = isMulti ? calcTotalFromSegments(segs) : (w.wallLengthMm ?? 0);
        const inf =
          editPolyMm && editPolyMm.length === wallList.length
            ? inferEdgePlanAxisFromVertices(editPolyMm, wi, closedLoop)
            : null;
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
          cfNote: normalizeScaffoldWallCfKey((w as { cfNote?: string }).cfNote),
          edgePlanAxis: inf?.axis ?? 'X',
          edgePlanAxisMm: inf?.mm ?? lengthMm,
        };
      });
      setWalls(mapped);
      const storedEh = (editConfig.calculationResult as { edgeHashiraLabeling?: EdgeHashiraLabeling } | undefined)
        ?.edgeHashiraLabeling;
      setHashiraRows(formRowsFromStoredLabeling(storedEh, mapped.length));
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
      setHashiraRows([]);
    }
    if (editPolyMm) {
      setPolygonVertices(editPolyMm);
    }
    const uiPath = (editConfig.calculationResult as { uiInputPath?: CreateScaffoldConfigDto['inputUiPath'] } | undefined)
      ?.uiInputPath;
    if (uiPath === 'quick') {
      setManualSubTab('quick');
      setInputMode('quick');
    } else {
      setManualSubTab('drawing');
      // CAD / AI edits use the shared manual panel + wall table (no full CAD/AI wizard rehydrate here).
      setInputMode('drawing');
    }
  }, [editConfigId, editConfig]);

  useEffect(() => {
    setSelectedWallIdx((prev) => {
      if (walls.length === 0) return null;
      if (prev == null) return 0;
      return Math.max(0, Math.min(prev, walls.length - 1));
    });
  }, [walls.length]);

  useEffect(() => {
    if (!aiBimPreview) {
      setAiBimEdgeHashira([]);
      setAiBimEdgeCf([]);
      return;
    }
    const n = aiBimPreview.walls.length;
    setAiBimEdgeHashira((prev) => (prev.length === n ? prev : formRowsFromWallCount(prev, n)));
    setAiBimEdgeCf((prev) => {
      if (prev.length === n) return prev.map((x) => normalizeScaffoldWallCfKey(x));
      const next = prev.slice(0, n).map((x) => normalizeScaffoldWallCfKey(x));
      while (next.length < n) next.push('reflex');
      return next;
    });
  }, [aiBimPreview]);

  const aiFootprintKey = useMemo(
    () =>
      aiBimPreview?.buildingOutline
        ? aiBimPreview.buildingOutline.map((p) => `${p.xFrac},${p.yFrac}`).join('|')
        : '',
    [aiBimPreview?.buildingOutline],
  );

  useEffect(() => {
    if (!aiFootprintKey) return;
    setAiFootprintPreviewZoom(1);
    setAiFootprintPreviewPan({ x: 0, y: 0 });
  }, [aiFootprintKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || editConfigId) return;
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(
          SCAFFOLD_WIZARD_DRAFT_KEY,
          JSON.stringify({
            v: WIZARD_DRAFT_SAVE_VERSION,
            savedAt: Date.now(),
            walls,
            polygonVertices,
            hashiraRows,
            buildingHeightMm,
            scaffoldWidthMm,
            inputMode,
            manualSubTab,
            prefilled,
            pendingInputUiPath,
            quickShapeDraft,
            aiBimPreview,
            aiBimEdgeHashira,
            aiBimEdgeCf,
          }),
        );
      } catch {
        /* quota */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [
    editConfigId,
    walls,
    polygonVertices,
    hashiraRows,
    buildingHeightMm,
    scaffoldWidthMm,
    inputMode,
    manualSubTab,
    prefilled,
    pendingInputUiPath,
    quickShapeDraft,
    aiBimPreview,
    aiBimEdgeHashira,
    aiBimEdgeCf,
  ]);

  const closedFootprintChords =
    walls.length >= 3 && (perimeterModel.isClosed || polygonVertices.length >= 3);
  const wallChordAt = (index: number) =>
    edgeChordName(index, walls.length, closedFootprintChords);

  const footprintForPreview = useMemo(() => {
    if (walls.length < 3) return null;
    return footprintVerticesForWallPreview(polygonVertices, walls, closedFootprintChords);
  }, [polygonVertices, walls, closedFootprintChords]);

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
    closed: boolean;
  }) => {
    const { vertices, labels, activeIndex, closed } = props;
    const n = vertices.length;
    if (n < 2) return null;

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
    const edgeSw = Math.max(3, (w + h) * 0.0025);
    const effectiveClosed = closed && n >= 3;
    const edgeCount = effectiveClosed ? n : Math.max(0, n - 1);
    if (edgeCount < 1) return null;

    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    return (
      <svg viewBox={vb} className="w-full h-56 rounded-lg bg-gray-50 border border-gray-200" preserveAspectRatio="xMidYMid meet">
        {effectiveClosed ? (
          <polygon
            points={points}
            fill="#eef2ff"
            stroke="#6366f1"
            strokeWidth={edgeSw}
            strokeLinejoin="round"
          />
        ) : (
          <polyline
            points={points}
            fill="none"
            stroke="#c7d2fe"
            strokeWidth={edgeSw}
            strokeLinejoin="round"
          />
        )}
        {Array.from({ length: edgeCount }, (_, i) => {
          const a = vertices[i];
          const b = effectiveClosed ? vertices[(i + 1) % n] : vertices[i + 1];
          if (!a || !b) return null;
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
                strokeWidth={isActive ? edgeSw * 2.2 : edgeSw * 1.25}
                opacity={isActive ? 0.95 : 0.45}
                strokeLinecap="round"
              />
              <circle
                cx={a.x}
                cy={a.y}
                r={Math.max(5, edgeSw * 2.2)}
                fill={isActive ? '#fb923c' : '#6366f1'}
                opacity={0.9}
              />
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
        {!effectiveClosed && n > 0 ? (
          <circle
            cx={vertices[n - 1].x}
            cy={vertices[n - 1].y}
            r={Math.max(5, edgeSw * 2.2)}
            fill="#6366f1"
            opacity={0.9}
          />
        ) : null}
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
    // Do not yank users off CAD / AI into Quick when file upload is gated (manualSubTab defaults to 'drawing').
    if (
      !canFile &&
      manualSubTab === 'drawing' &&
      !editConfigId &&
      inputMode !== 'cad_draw' &&
      inputMode !== 'ai_extract'
    ) {
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

  const handleCadLiveFootprintMmChange = useCallback(
    (verticesMm: Array<{ x: number; y: number }> | null, isClosed: boolean) => {
      setCadLiveFootprintMm(verticesMm);
      setCadLiveFootprintClosed(isClosed);
    },
    [],
  );

  useEffect(() => {
    if (inputMode !== 'cad_draw' || editConfigId) {
      setCadLiveFootprintMm(null);
      setCadLiveFootprintClosed(false);
    }
  }, [inputMode, editConfigId]);

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
      if (detected.length === 0) {
        setPolygonVertices([]);
        setWalls([]);
        setHashiraRows((prev) => formRowsFromWallCount(prev, 0));
        return;
      }
      if (vertices && vertices.length >= 3) {
        setPolygonVertices(vertices);
      }
      setWalls((prev) => {
        const closed = detected.length >= 3;
        const vertForInfer =
          vertices && vertices.length === detected.length ? vertices : null;
        return detected.map((w, i) => {
          const inf =
            vertForInfer && vertForInfer.length >= 3
              ? inferEdgePlanAxisFromVertices(vertForInfer, i, closed)
              : null;
          const existing = prev[i];
          if (existing && existing.side === w.side) {
            const axis = existing.edgePlanAxis ?? inf?.axis ?? 'X';
            let mmFromGeom: number | null = null;
            if (vertForInfer && vertForInfer.length >= 2) {
              const nV = vertForInfer.length;
              const nextIdx = closed ? (i + 1) % nV : i + 1;
              if (nextIdx < nV) {
                mmFromGeom = Math.round(
                  axis === 'X'
                    ? vertForInfer[nextIdx].x - vertForInfer[i].x
                    : vertForInfer[nextIdx].y - vertForInfer[i].y,
                );
              }
            }
            const edgePlanAxisMm =
              existing.edgePlanAxisMm != null
                ? existing.edgePlanAxisMm
                : mmFromGeom ?? inf?.mm ?? w.lengthMm;
            return {
              ...existing,
              lengthMm: w.lengthMm,
              edgePlanAxis: axis,
              edgePlanAxisMm,
              cfNote: normalizeScaffoldWallCfKey(existing.cfNote),
            };
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
            cfNote: 'reflex',
            edgePlanAxis: inf?.axis ?? 'X',
            edgePlanAxisMm: inf?.mm ?? w.lengthMm,
          };
        });
      });
      setHashiraRows((prev) => formRowsFromWallCount(prev, detected.length));
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

  const syncEdgePlanMmFromPolygon = useCallback(
    (wallIndex: number, axis: 'X' | 'Y'): number | null => {
      const verts = polygonVertices;
      if (verts.length < 2 || wallIndex < 0 || wallIndex >= verts.length) return null;
      const closedFootprint = verts.length >= 3 && walls.length === verts.length;
      const n = verts.length;
      const nextIdx = closedFootprint ? (wallIndex + 1) % n : wallIndex + 1;
      if (nextIdx >= n) return null;
      return Math.round(
        axis === 'X' ? verts[nextIdx].x - verts[wallIndex].x : verts[nextIdx].y - verts[wallIndex].y,
      );
    },
    [polygonVertices, walls.length],
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

    const edgeHashiraLabeling = labelingForEnabledWallIndices(enabledOriginalIndices, hashiraRows);

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
      ...(edgeHashiraLabeling ? { edgeHashiraLabeling } : {}),
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <ScanLine className="h-5 w-5 text-violet-600" />
                {t('scaffold', 'aiExtractModeTitle')}
              </h2>
              <p className="text-sm text-gray-600">
                {aiBimPreview
                  ? t('scaffold', 'aiBimModeReady')
                  : t('scaffold', 'aiExtractModeDescription')}
              </p>
            </div>

            {!aiBimPreview ? (
              <div className="flex flex-col lg:flex-row" style={{ minHeight: 520 }}>
                <div className="flex-1 relative bg-gray-100 flex flex-col items-center justify-center p-8 min-h-[400px] text-center">
                  <Building2 className="h-14 w-14 text-gray-400 mb-3 mx-auto" />
                  <p className="text-sm text-gray-500 max-w-sm">
                    {t('scaffold', 'aiExtractModeDescription')}
                  </p>
                </div>
                <div className="w-full lg:w-96 flex flex-col border-t lg:border-t-0 lg:border-l border-gray-200 p-4 gap-3 shrink-0 bg-white">
                  <p className="text-xs text-violet-700/90">{t('scaffold', 'aiExtractColorSamplingHint')}</p>
            <label className="flex flex-col items-center justify-center w-full min-h-[200px] border-2 border-dashed border-violet-300 rounded-xl cursor-pointer bg-violet-50/50 hover:bg-violet-50 transition-colors px-4 py-8">
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
                  setPremiumScheduleError(null);
                  setPremiumScheduleInfo(null);
                  setAiBimUploading(true);
                  try {
                    const [raw, bimFacadeColors] = await Promise.all([
                      visionBimApi.analyze(file),
                      (async (): Promise<CreateScaffoldConfigDto['bimFacadeColors'] | undefined> => {
                        if (!isRasterImageUpload(file)) return undefined;
                        try {
                          const extracted = await extractBimFacadeColorsFromImageFile(file);
                          return extracted ?? undefined;
                        } catch {
                          return undefined;
                        }
                      })(),
                    ]);
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
                      ...(footprint.ifcPremiumMetadata && { ifcPremiumMetadata: footprint.ifcPremiumMetadata }),
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
              <div className="mt-2 flex items-center gap-2 text-violet-600 text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{t('scaffold', 'aiBimAnalyzing')}</span>
              </div>
            )}
            {aiBimError && (
              <div className="mt-2 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                {aiBimError}
              </div>
            )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row" style={{ minHeight: 520 }}>
                <div className="flex-1 relative bg-gray-100 p-4 flex flex-col gap-3 min-h-[400px]">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg shrink-0">
                    <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      {t('scaffoldExtra', 'extractionComplete')}
                    </p>
                  </div>
                  {aiBimPreview.ifcPremiumMetadata && (
                    <div className="text-xs rounded-lg border border-slate-200 bg-white p-3 space-y-1.5 shrink-0 max-h-44 overflow-y-auto">
                      <div className="font-semibold text-slate-800">
                        {t('scaffoldExtra', 'ifcPremiumMetaTitle')}
                      </div>
                      {(() => {
                        const m = aiBimPreview.ifcPremiumMetadata!;
                        return (
                          <div className="text-slate-600 space-y-1">
                            {m.projectName && (
                              <p>
                                <span className="text-slate-500">{t('scaffoldExtra', 'ifcPremiumProject')}: </span>
                                {m.projectName}
                              </p>
                            )}
                            {m.ifcSchema && (
                              <p>
                                <span className="text-slate-500">{t('scaffoldExtra', 'ifcPremiumSchema')}: </span>
                                {m.ifcSchema}
                              </p>
                            )}
                            <p>
                              <span className="text-slate-500">{t('scaffoldExtra', 'ifcPremiumStoreys')}: </span>
                              {m.storeys.length}
                              {m.storeys.length > 0 && m.storeys[0]?.elevationMm != null && (
                                <span className="text-slate-400">
                                  {' '}
                                  ( …{m.storeys.slice(0, 3).map((s) => (s.elevationMm != null ? `${s.elevationMm}mm` : '—')).join(', ')}
                                  {m.storeys.length > 3 ? '…' : ''})
                                </span>
                              )}
                            </p>
                            <p>
                              <span className="text-slate-500">{t('scaffoldExtra', 'ifcPremiumGrids')}: </span>
                              {m.grids.length}
                              {m.grids[0] && (
                                <span className="text-slate-400">
                                  {' '}
                                  —
                                  {[
                                    ...m.grids[0].uAxes.map((a) => a.axisTag).filter(Boolean),
                                    ...m.grids[0].vAxes.map((a) => a.axisTag).filter(Boolean),
                                  ]
                                    .slice(0, 8)
                                    .join(', ') || '—'}
                                </span>
                              )}
                            </p>
                            {m.propertySetNameSample.length > 0 && (
                              <p className="break-words">
                                <span className="text-slate-500">{t('scaffoldExtra', 'ifcPremiumPsets')}: </span>
                                {m.propertySetNameSample.slice(0, 12).join(', ')}
                                {m.propertySetNameSample.length > 12 ? '…' : ''}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <div
                    className="relative flex-1 min-h-[280px] rounded-lg border border-gray-200 bg-white overflow-hidden"
                    onWheel={(e) => {
                      e.preventDefault();
                      const factor = e.deltaY > 0 ? 0.9 : 1.1;
                      setAiFootprintPreviewZoom((z) => Math.min(8, Math.max(0.25, z * factor)));
                    }}
                  >
                    <div className="absolute top-2 right-2 z-10">
                      <PreviewZoomToolbar
                        onZoomIn={() => setAiFootprintPreviewZoom((z) => Math.min(8, z * 1.15))}
                        onZoomOut={() => setAiFootprintPreviewZoom((z) => Math.max(0.25, z / 1.15))}
                        onReset={() => {
                          setAiFootprintPreviewZoom(1);
                          setAiFootprintPreviewPan({ x: 0, y: 0 });
                        }}
                      />
                    </div>
                    <BuildingShapeSvg
                      outline={aiBimPreview.buildingOutline}
                      wallLengthsMm={aiBimPreview.walls.map((w) => w.wallLengthMm)}
                      viewZoom={aiFootprintPreviewZoom}
                      viewPan={aiFootprintPreviewPan}
                      className="w-full h-full min-h-[260px]"
                    />
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setAiBimPreview(null);
                        setAiBimExtractOutline(null);
                        setAiBimCompareExtract(false);
                        setAiBimError(null);
                        setPremiumScheduleError(null);
                        setPremiumScheduleInfo(null);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('scaffoldExtra', 'uploadAnotherFile')}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-w-0 border-t lg:border-t-0 lg:border-l border-gray-200 p-5 bg-gray-50/50 space-y-4 overflow-y-auto max-h-[85vh]">
                  <h3 className="text-sm font-semibold text-gray-800">{t('scaffold', 'aiBimReviewTitle')}</h3>
                  {canAi && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2">
                      <div className="text-xs font-semibold text-violet-900 flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        {t('scaffoldExtra', 'premiumScheduleImportTitle')}
                      </div>
                      <p className="text-[11px] text-violet-900/85 leading-snug">
                        {t('scaffoldExtra', 'premiumScheduleImportHint')}
                      </p>
                      <label className="flex flex-col items-center justify-center w-full py-2 px-2 border border-dashed border-violet-300 rounded-lg cursor-pointer bg-white/80 hover:bg-white text-center">
                        <span className="text-[11px] text-violet-700 font-medium">
                          JSON · CSV · .txt
                        </span>
                        <input
                          type="file"
                          accept=".json,.csv,.txt,application/json,text/csv,text/plain"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            setPremiumScheduleError(null);
                            setPremiumScheduleInfo(null);
                            try {
                              const schedule = await visionBimApi.importPremiumSchedule(f);
                              setAiBimPreview((prev) => {
                                if (!prev) return prev;
                                return applyPremiumScheduleToAiPreview(prev, schedule);
                              });
                              const w = schedule.warnings.filter(Boolean);
                              setPremiumScheduleInfo(
                                w.length > 0
                                  ? `${t('scaffoldExtra', 'premiumScheduleApplied')} (${w.join(' ')})`
                                  : t('scaffoldExtra', 'premiumScheduleApplied'),
                              );
                            } catch (err: unknown) {
                              const msg =
                                err && typeof err === 'object' && 'message' in err
                                  ? String((err as { message: string }).message)
                                  : t('scaffoldExtra', 'premiumScheduleImportFailed');
                              setPremiumScheduleError(msg);
                            } finally {
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                      {premiumScheduleError && (
                        <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">
                          {premiumScheduleError}
                        </p>
                      )}
                      {premiumScheduleInfo && (
                        <p className="text-[11px] text-green-800 bg-green-50 border border-green-100 rounded px-2 py-1">
                          {premiumScheduleInfo}
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {aiBimPreview.isStepped ? t('scaffold', 'aiBimMaxBuildingHeight') : t('scaffold', 'aiBimBuildingHeight')}
                    </label>
                    <div className="flex items-center gap-2 max-w-[220px]">
                      <input
                        type="number"
                        value={
                          aiBimPreview.buildingHeightMm >= 1000
                            ? Math.round(mmToM(aiBimPreview.buildingHeightMm) * 10000) / 10000
                            : ''
                        }
                        onChange={(e) => {
                          const m = parseFloat(e.target.value);
                          const h = Math.max(1000, Number.isFinite(m) ? mToMm(m) : 1000);
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
                        min={1}
                        step={0.01}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-violet-500"
                      />
                      <span className="text-xs text-gray-500 shrink-0">m</span>
                    </div>
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
                            <th className="text-left py-2 px-2 font-medium text-gray-700">
                              {t('scaffoldExtra', 'edgeXYRun') || 'XY'}
                            </th>
                            <th className="text-left py-2 px-2 font-medium text-gray-700">CF</th>
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
                                  value={w.wallLengthMm > 0 ? Math.round(mmToM(w.wallLengthMm) * 10000) / 10000 : ''}
                                  onChange={(e) => {
                                    const m = parseFloat(e.target.value);
                                    const len = Math.max(600, Number.isFinite(m) ? mToMm(m) : 600);
                                    const newWalls = aiBimPreview.walls.map((wall, j) =>
                                      j === i ? { ...wall, wallLengthMm: len } : wall,
                                    );
                                    setAiBimPreview({
                                      ...aiBimPreview,
                                      walls: newWalls,
                                      dto: { ...aiBimPreview.dto, walls: newWalls },
                                    });
                                  }}
                                  min={0.6}
                                  step={0.01}
                                  className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-right font-mono focus:ring-2 focus:ring-violet-500"
                                />
                              </td>
                              <td className="py-2 px-3 text-right">
                                <input
                                  type="number"
                                  value={(() => {
                                    const hMm = w.wallHeightMm ?? aiBimPreview.buildingHeightMm;
                                    return hMm >= 1000 ? Math.round(mmToM(hMm) * 10000) / 10000 : '';
                                  })()}
                                  onChange={(e) => {
                                    const m = parseFloat(e.target.value);
                                    const h = Math.max(1000, Number.isFinite(m) ? mToMm(m) : 1000);
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
                                  min={1}
                                  step={0.01}
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
                                  <option value="">{formatMmLabel(aiBimPreview.dto.scaffoldWidthMm)}</option>
                                  {[...SCAFFOLD_WIDTH_CATALOG_MM].filter((wmm) => wmm !== aiBimPreview.dto.scaffoldWidthMm).map((wmm) => (
                                    <option key={wmm} value={wmm}>{formatMmLabel(wmm)}</option>
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
                              <td className="py-2 px-2 align-top">
                                {(() => {
                                  const hr = aiBimEdgeHashira[i] ?? { axis: '' as const, countStr: '' };
                                  const aiClosed = aiBimPreview.walls.length >= 3;
                                  const aiVerts = aiBimPreview.buildingOutline.map((p) => ({
                                    x: p.xFrac,
                                    y: p.yFrac,
                                  }));
                                  const inf =
                                    aiVerts.length === aiBimPreview.walls.length
                                      ? inferEdgePlanAxisFromVertices(aiVerts, i, aiClosed)
                                      : null;
                                  const effectiveAxis: 'X' | 'Y' =
                                    (hr.axis === 'X' || hr.axis === 'Y' ? hr.axis : null) ??
                                    inf?.axis ??
                                    'X';
                                  const rawStation = hr.countStr.trim();
                                  const stationParsed =
                                    rawStation === '' ? Number.NaN : parseInt(rawStation, 10);
                                  const stationEnd =
                                    Number.isFinite(stationParsed) && stationParsed > 0
                                      ? Math.min(500, Math.floor(stationParsed))
                                      : null;
                                  return (
                                    <div className="flex flex-col gap-0.5 min-w-[4.5rem]">
                                      <div className="flex flex-wrap gap-1 items-center">
                                        <select
                                          value={effectiveAxis}
                                          onChange={(e) => {
                                            const axis = e.target.value as 'X' | 'Y';
                                            setAiBimEdgeHashira((prev) => {
                                              const next = [...prev];
                                              const cur = next[i] ?? { axis: '' as const, countStr: '' };
                                              next[i] = { ...cur, axis };
                                              return next;
                                            });
                                          }}
                                          className="w-10 rounded border border-gray-300 px-0.5 py-0.5 text-[10px] font-semibold bg-gray-50"
                                        >
                                          <option value="X">X</option>
                                          <option value="Y">Y</option>
                                        </select>
                                        <select
                                          value={stationEnd != null ? String(stationEnd) : ''}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            setAiBimEdgeHashira((prev) => {
                                              const next = [...prev];
                                              const cur = next[i] ?? { axis: '' as const, countStr: '' };
                                              next[i] = {
                                                ...cur,
                                                axis: effectiveAxis,
                                                countStr: v === '' ? '' : v,
                                              };
                                              return next;
                                            });
                                          }}
                                          title={
                                            (t('scaffoldExtra', 'edgePlanStationEndHint') as string) || ''
                                          }
                                          className="min-w-[2.75rem] rounded border border-gray-300 px-0.5 py-0.5 text-[10px] font-mono bg-white"
                                        >
                                          <option value="">
                                            {t('scaffoldExtra', 'edgePlanStationEnd') || '#'}
                                          </option>
                                          {HASHIRA_STATION_OPTIONS.map((n) => (
                                            <option key={n} value={n}>
                                              {n}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      {stationEnd != null ? (
                                        <span className="text-[9px] font-mono text-violet-800 font-semibold">
                                          {`${effectiveAxis}1\u2013${effectiveAxis}${stationEnd}`}
                                        </span>
                                      ) : null}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="py-2 px-2 align-top">
                                <select
                                  value={normalizeScaffoldWallCfKey(aiBimEdgeCf[i])}
                                  onChange={(e) => {
                                    const v = normalizeScaffoldWallCfKey(e.target.value);
                                    setAiBimEdgeCf((prev) => {
                                      const next = [...prev];
                                      next[i] = v;
                                      return next;
                                    });
                                  }}
                                  className="w-full min-w-[5.5rem] rounded border border-gray-300 px-1 py-0.5 text-[10px] bg-white"
                                >
                                  {SCAFFOLD_WALL_CF_KEYS.map((cfKey) => (
                                    <option key={cfKey} value={cfKey}>
                                      {t(
                                        'scaffoldExtra',
                                        cfKey === 'reflex' ? 'wallCfReflex' : 'wallCfC',
                                      ) || cfKey}
                                    </option>
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
                            <td colSpan={5} />
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
                                const width = Number(e.target.value) || SCAFFOLD_WIDTH_NARROW_MM;
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
                              {[...SCAFFOLD_WIDTH_CATALOG_MM].map((w) => (
                                <option key={w} value={w}>
                                  {formatMmLabel(w)}
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
                                    {formatMmLabel(v)}
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
                        const hashiraForDto = formRowsFromWallCount(
                          aiBimEdgeHashira,
                          sanitizedWalls.length,
                        );
                        const allWallIndices = sanitizedWalls.map((_, idx) => idx);
                        const edgeHashiraFromAi = labelingForEnabledWallIndices(
                          allWallIndices,
                          hashiraForDto,
                        );
                        const dto = {
                          ...dtoBase,
                          walls: sanitizedWalls,
                          siteName: '',
                          siteAddress: '',
                          siteEmail: '',
                          sitePhone: '',
                          siteFax: '',
                          pattankoCornerCount: outline && outline.length >= 3 ? countPattankoCorners(outline) : undefined,
                          ...(edgeHashiraFromAi ? { edgeHashiraLabeling: edgeHashiraFromAi } : {}),
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <PenTool className="h-5 w-5 text-emerald-600" />
                {t('scaffoldExtra', 'cadDrawTitle')}
              </h2>
              <p className="text-sm text-gray-600">{t('scaffoldExtra', 'cadDrawDescription')}</p>
            </div>
            <CadDrawingCanvas
              buildingHeightMm={buildingHeightMm ?? 3000}
              onBuildingHeightChange={(h) => setBuildingHeightMm(h)}
              onLiveFootprintMmChange={handleCadLiveFootprintMmChange}
              onComplete={(result) => {
                setCadLiveFootprintMm(null);
                setCadLiveFootprintClosed(false);
                const verts = result.vertices.map((v) => ({ x: v.xFrac, y: v.yFrac }));
                const nW = result.walls.length;
                const closed = verts.length >= 3 && verts.length === nW;
                const mapped: WallState[] = result.walls.map((w, i) => {
                  const inf =
                    verts.length >= 3 && verts.length === nW
                      ? inferEdgePlanAxisFromVertices(verts, i, closed)
                      : null;
                  return {
                    side: w.side,
                    enabled: true,
                    lengthMm: w.wallLengthMm,
                    heightMm: w.wallHeightMm,
                    stairAccessCount: w.stairAccessCount,
                    kaidanCount: 0,
                    kaidanOffsets: [],
                    isMultiSegment: false,
                    segments: [{ lengthMm: w.wallLengthMm, offsetMm: 0 }],
                    cfNote: normalizeScaffoldWallCfKey(w.cfNote ?? 'reflex'),
                    edgePlanAxis: w.edgePlanAxis ?? inf?.axis ?? 'X',
                    edgePlanAxisMm: w.edgePlanAxisMm ?? inf?.mm ?? w.wallLengthMm,
                  };
                });
                setWalls(mapped);
                setHashiraRows((prev) =>
                  result.edgeHashiraRows && result.edgeHashiraRows.length === mapped.length
                    ? result.edgeHashiraRows
                    : formRowsFromWallCount(prev, mapped.length),
                );
                setBuildingHeightMm(result.buildingHeightMm);
                setPolygonVertices(verts);
                setPrefilled(true);
                setPendingInputUiPath('cad_draw');
              }}
              className="w-full min-w-0"
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
            initialDraft={quickShapeDraft}
            onDraftChange={handleQuickShapeDraftChange}
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
        subscriptionInfo?.plan === 'free_trial' &&
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
            persistSession={!editConfigId}
            onWallsDetected={handleWallsDetected}
            onSegmentEdit={handleSegmentEdit}
            externalWallLengths={walls.map(w => w.lengthMm)}
            buildingHeightMm={buildingHeightMm}
            onBuildingHeightChange={setBuildingHeightMm}
            buildingHeightLabel={t('scaffold', 'defaultHeightForDrawingMm')}
            buildingHeightHint={t('scaffold', 'defaultHeightDrawingHint')}
            wallHeightsMm={walls.map((w) => w.heightMm)}
            onWallHeightMmChange={(edgeIdx, mm) => updateWall(edgeIdx, { heightMm: mm })}
            wallCfNotes={walls.map((w) => normalizeScaffoldWallCfKey(w.cfNote))}
            onWallCfNoteChange={(edgeIdx, note) => updateWall(edgeIdx, { cfNote: note })}
            edgePlanAxes={walls.map((w) => w.edgePlanAxis ?? 'X')}
            edgePlanAxisMm={walls.map((w) => w.edgePlanAxisMm ?? w.lengthMm)}
            onEdgePlanAxisChange={(edgeIdx, axis) => {
              const mm = syncEdgePlanMmFromPolygon(edgeIdx, axis);
              updateWall(edgeIdx, {
                edgePlanAxis: axis,
                ...(mm != null ? { edgePlanAxisMm: mm } : {}),
              });
            }}
            onEdgePlanAxisMmChange={(edgeIdx, mm) =>
              updateWall(edgeIdx, { edgePlanAxisMm: mm })
            }
            edgeHashiraRows={hashiraRows}
            onEdgeHashiraRowChange={(wi, patch) => {
              setHashiraRows((prev) => {
                const next = [...prev];
                const cur = next[wi] ?? { axis: '' as const, countStr: '' };
                next[wi] = { ...cur, ...patch };
                return next;
              });
            }}
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
                      <option value="">{formatMmLabel(scaffoldWidthMm)}</option>
                      {[...SCAFFOLD_WIDTH_CATALOG_MM].filter((w) => w !== scaffoldWidthMm).map((w) => (
                        <option key={w} value={w}>{formatMmLabel(w)}</option>
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
                    <span className="text-[10px] text-gray-400">
                      {t('scaffold', 'defaultScaffoldWidthTag')}
                      {formatMmLabel(scaffoldWidthMm)}
                    </span>
                  )}
                </div>

                {(() => {
                  const hr = hashiraRows[i] ?? { axis: '' as const, countStr: '' };
                  const hashiraAxis = hr.axis === 'X' || hr.axis === 'Y' ? hr.axis : null;
                  const effectiveAxis: 'X' | 'Y' =
                    hashiraAxis ?? wall.edgePlanAxis ?? 'X';
                  const rawStation = hr.countStr.trim();
                  const stationParsed =
                    rawStation === '' ? Number.NaN : parseInt(rawStation, 10);
                  const stationEnd =
                    Number.isFinite(stationParsed) && stationParsed > 0
                      ? Math.min(500, Math.floor(stationParsed))
                      : null;
                  const xyBox =
                    'rounded-md border border-gray-200 bg-white/90 px-2 py-1.5 shadow-sm min-w-0';
                  return (
                    <div
                      className="mt-2 flex flex-wrap items-end gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={xyBox}>
                        <span className="text-[10px] text-gray-500 block mb-0.5">
                          {t('scaffoldExtra', 'edgeXYRun') || 'XY'}
                        </span>
                        <div className="flex flex-wrap gap-1 items-center">
                          <select
                            value={effectiveAxis}
                            disabled={!wall.enabled}
                            onChange={(e) => {
                              const axis = e.target.value as 'X' | 'Y';
                              const mm = syncEdgePlanMmFromPolygon(i, axis);
                              updateWall(i, {
                                edgePlanAxis: axis,
                                ...(mm != null ? { edgePlanAxisMm: mm } : {}),
                              });
                              setHashiraRows((prev) => {
                                const next = [...prev];
                                const cur = next[i] ?? { axis: '' as const, countStr: '' };
                                next[i] = { ...cur, axis };
                                return next;
                              });
                            }}
                            className="w-11 rounded border border-gray-200 px-1 py-0.5 text-[11px] font-semibold bg-gray-50 disabled:opacity-50"
                          >
                            <option value="X">X</option>
                            <option value="Y">Y</option>
                          </select>
                          <select
                            value={stationEnd != null ? String(stationEnd) : ''}
                            disabled={!wall.enabled}
                            onChange={(e) => {
                              const v = e.target.value;
                              setHashiraRows((prev) => {
                                const next = [...prev];
                                const cur = next[i] ?? { axis: '' as const, countStr: '' };
                                next[i] = {
                                  ...cur,
                                  axis: effectiveAxis,
                                  countStr: v === '' ? '' : v,
                                };
                                return next;
                              });
                            }}
                            title={
                              (t('scaffoldExtra', 'edgePlanStationEndHint') as string) || ''
                            }
                            className="min-w-[3.25rem] rounded border border-gray-200 px-1 py-0.5 text-[11px] font-mono bg-white disabled:opacity-50"
                          >
                            <option value="">
                              {t('scaffoldExtra', 'edgePlanStationEnd') || 'To #'}
                            </option>
                            {HASHIRA_STATION_OPTIONS.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                        {stationEnd != null ? (
                          <p className="text-[9px] font-mono text-blue-800 mt-0.5 font-semibold">
                            {`${effectiveAxis}1\u2013${effectiveAxis}${stationEnd}`}
                          </p>
                        ) : null}
                      </div>
                      <div className={xyBox}>
                        <span className="text-[10px] text-gray-500 block mb-0.5">CF</span>
                        <select
                          value={normalizeScaffoldWallCfKey(wall.cfNote)}
                          disabled={!wall.enabled}
                          onChange={(e) =>
                            updateWall(i, {
                              cfNote: normalizeScaffoldWallCfKey(e.target.value),
                            })
                          }
                          className="min-w-[7.5rem] rounded border border-gray-200 px-1.5 py-0.5 text-[11px] bg-white disabled:opacity-50"
                        >
                          {SCAFFOLD_WALL_CF_KEYS.map((cfKey) => (
                            <option key={cfKey} value={cfKey}>
                              {t(
                                'scaffoldExtra',
                                cfKey === 'reflex' ? 'wallCfReflex' : 'wallCfC',
                              ) || cfKey}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })()}

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
                          Total: {formatMmAsMetersLabel(calcTotalFromSegments(wall.segments))}
                          {wall.segments.length > 1 && (
                            <span className="text-gray-400 ml-1">
                              ({wall.segments.length} segments +{' '}
                              {formatMmAsMetersLabel(
                                wall.segments.reduce(
                                  (sum, _, idx) =>
                                    idx > 0
                                      ? sum + Math.abs(wall.segments[idx].offsetMm - wall.segments[idx - 1].offsetMm)
                                      : sum,
                                  0,
                                ),
                              )}{' '}
                              returns)
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
                              <label className="text-xs text-gray-600">L (m):</label>
                              <input
                                type="number"
                                value={seg.lengthMm > 0 ? Math.round(mmToM(seg.lengthMm) * 10000) / 10000 : ''}
                                onChange={(e) => {
                                  const m = parseFloat(e.target.value);
                                  const lenMm = Number.isFinite(m) ? mToMm(m) : 0;
                                  const newSegs = [...wall.segments];
                                  newSegs[segIdx] = { ...newSegs[segIdx], lengthMm: lenMm };
                                  const total = calcTotalFromSegments(newSegs);
                                  updateWall(i, { segments: newSegs, lengthMm: total });
                                }}
                                placeholder="5"
                                className="w-24 rounded border border-orange-300 px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500"
                                min={0.6}
                                step={0.01}
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-gray-600">Offset (m):</label>
                              <input
                                type="number"
                                value={Math.round(mmToM(seg.offsetMm) * 10000) / 10000}
                                onChange={(e) => {
                                  const m = parseFloat(e.target.value);
                                  const offMm = Number.isFinite(m) ? mToMm(m) : 0;
                                  const newSegs = [...wall.segments];
                                  newSegs[segIdx] = { ...newSegs[segIdx], offsetMm: offMm };
                                  const total = calcTotalFromSegments(newSegs);
                                  updateWall(i, { segments: newSegs, lengthMm: total });
                                }}
                                placeholder="0"
                                className="w-20 rounded border border-orange-300 px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500"
                                step={0.01}
                              />
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
                    closed={closedFootprintChords}
                  />
                ) : (
                  <div className="text-xs text-gray-500 rounded-lg border border-dashed border-gray-300 p-4">
                    {t('scaffoldExtra', 'wallConfigPreviewHint') ||
                      'Add at least three walls, or trace/upload an outline so the plan preview can render.'}
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
