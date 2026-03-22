'use client';

import { useState, useCallback, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  scaffoldConfigsApi,
  CreateScaffoldConfigDto,
  ScaffoldRules,
  WallInput,
  WallSegment,
} from '@/lib/api/scaffold-configs';
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

// Dynamic import for PerimeterTracer (uses browser APIs)
const PerimeterTracer = dynamic(
  () =>
    import('@/components/perimeter-tracer/PerimeterTracer').then(m => ({
      default: m.PerimeterTracer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-96 flex items-center justify-center text-gray-400 bg-white rounded-xl border border-gray-200">
        Loading Perimeter Tracer…
      </div>
    ),
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

type IfcPreviewMesh = {
  vertices: Float32Array;
  indices: Uint32Array;
  color: { r: number; g: number; b: number; a: number };
  elementType: import('@/lib/ifc-loader').IfcElementType;
  expressID: number;
};

const IFC_PREVIEW_MESH_CACHE = new Map<string, IfcPreviewMesh[]>();

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

/** Renders building footprint outline as SVG (for AI BIM double-check panel). */
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

/** 3D building preview — renders extruded footprint with Three.js (for AI BIM confirmation). */
function Building3DPreview({
  outline,
  buildingHeightMm,
  wallLengthsMm,
  wallHeightsMm,
  massingTiers,
  ifcFileUrl,
  ifcArrayBuffer,
  className,
  style,
}: {
  outline: Array<{ xFrac: number; yFrac: number }>;
  buildingHeightMm: number;
  wallLengthsMm?: number[];
  wallHeightsMm?: number[];
  massingTiers?: VisionMassingTier[];
  ifcFileUrl?: string;
  ifcArrayBuffer?: ArrayBuffer;
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

      // Optional: overlay actual IFC mesh in preview (same footprint frame).
      const ifcSource = ifcArrayBuffer || ifcFileUrl;
      let previewBimMats: any = null;
      if (ifcSource) {
        (async () => {
          try {
            const cacheKey = typeof ifcSource === 'string' ? ifcSource : '__local_ifc__';
            let meshes = IFC_PREVIEW_MESH_CACHE.get(cacheKey);
            if (!meshes) {
              let arrayBuffer: ArrayBuffer;
              if (ifcArrayBuffer) {
                arrayBuffer = ifcArrayBuffer;
              } else {
                const response = await fetch(ifcFileUrl!);
                if (!response.ok) {
                  console.warn('[Building3DPreview] IFC fetch failed:', response.status);
                  return;
                }
                arrayBuffer = await response.arrayBuffer();
              }
              const { parseIfcToMeshes } = await import('@/lib/ifc-loader');
              meshes = await parseIfcToMeshes(arrayBuffer);
              IFC_PREVIEW_MESH_CACHE.set(cacheKey, meshes);
            }
            if (disposed || !meshes || meshes.length === 0) return;

            let minMx = Infinity; let maxMx = -Infinity;
            let minMy = Infinity; let maxMy = -Infinity;
            let minMz = Infinity; let maxMz = -Infinity;
            for (const mesh of meshes) {
              const stride = 6;
              for (let vi = 0; vi < mesh.vertices.length; vi += stride) {
                const x = mesh.vertices[vi];
                const y = mesh.vertices[vi + 1];
                const z = mesh.vertices[vi + 2];
                if (x < minMx) minMx = x; if (x > maxMx) maxMx = x;
                if (y < minMy) minMy = y; if (y > maxMy) maxMy = y;
                if (z < minMz) minMz = z; if (z > maxMz) maxMz = z;
              }
            }
            if (!Number.isFinite(minMx) || !Number.isFinite(maxMx)) return;

            const rawSpanX = Math.max(maxMx - minMx, 1e-6);
            const rawSpanY = Math.max(maxMy - minMy, 1e-6);
            const rawSpanZ = Math.max(maxMz - minMz, 1e-6);
            const rawMaxSpan = Math.max(rawSpanX, rawSpanY, rawSpanZ);
            const rawToM = rawMaxSpan > 500 ? 0.001 : 1;

            const ifcSpanX = rawSpanX * rawToM;
            const ifcSpanY = rawSpanY * rawToM;
            const ifcSpanZ = rawSpanZ * rawToM;
            const targetSpanX = Math.max(planSpanXM, 1e-6);
            const targetSpanZ = Math.max(planSpanZM, 1e-6);
            const scaleXY = Math.min(targetSpanX / ifcSpanX, targetSpanZ / ifcSpanZ);
            const scaleY = ifcSpanY > 1e-6 ? (heightM / ifcSpanY) : scaleXY;

            const centerX = (minMx + maxMx) / 2;
            const centerZ = (minMz + maxMz) / 2;

            const ifcGroup = new THREE.Group();
            for (const meshData of meshes) {
              const stride = 6;
              const vertCount = meshData.vertices.length / stride;
              const positions = new Float32Array(vertCount * 3);
              const normals = new Float32Array(vertCount * 3);
              for (let vi = 0; vi < vertCount; vi++) {
                positions[vi * 3] = (meshData.vertices[vi * stride] - centerX) * rawToM * scaleXY;
                positions[vi * 3 + 1] = (meshData.vertices[vi * stride + 1] - minMy) * rawToM * scaleY;
                positions[vi * 3 + 2] = (meshData.vertices[vi * stride + 2] - centerZ) * rawToM * scaleXY;
                normals[vi * 3] = meshData.vertices[vi * stride + 3];
                normals[vi * 3 + 1] = meshData.vertices[vi * stride + 4];
                normals[vi * 3 + 2] = meshData.vertices[vi * stride + 5];
              }

              const geo = new THREE.BufferGeometry();
              geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
              geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
              geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

              let mat: THREE.Material;
              try {
                const { createBimMaterialSet, getMaterialForElement } = await import('@/lib/ifc-bim-materials');
                if (!previewBimMats) previewBimMats = createBimMaterialSet(THREE);
                mat = getMaterialForElement(previewBimMats, meshData.elementType, meshData.expressID) as THREE.Material;
              } catch {
                mat = new THREE.MeshStandardMaterial({
                  color: new THREE.Color(meshData.color.r, meshData.color.g, meshData.color.b),
                  transparent: true,
                  opacity: Math.max(0.35, Math.min(0.92, meshData.color.a)),
                  side: THREE.DoubleSide, roughness: 0.75, metalness: 0.1,
                });
              }
              if (meshData.elementType === 'opening') continue;
              const m = new THREE.Mesh(geo, mat);
              m.castShadow = true; m.receiveShadow = true;
              ifcGroup.add(m);
            }
            if (disposed) return;
            scene.add(ifcGroup);
            fallbackGroup.visible = false;
            cleanupFns.push(() => {
              scene.remove(ifcGroup);
              ifcGroup.traverse((obj) => {
                const mesh = obj as THREE.Mesh;
                if ((mesh as any).isMesh) {
                  mesh.geometry?.dispose?.();
                  const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
                  if (Array.isArray(material)) material.forEach((m) => m.dispose());
                  else material?.dispose?.();
                }
              });
            });
          } catch {
            // Keep fallback extruded preview when IFC loading fails.
          }
        })();
      }

      // Camera
      const dist = Math.max(extent * 1.8, heightM * 2, 8);
      camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
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
  }, [outline, buildingHeightMm, wallLengthsMm, wallHeightsMm, massingTiers, ifcFileUrl, ifcArrayBuffer]);

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

/** Building preview panel with 2D (plan) / 3D toggle. */
function BuildingPreviewPanel({
  outline,
  wallLengthsMm,
  wallHeightsMm,
  massingTiers,
  buildingHeightMm,
  ifcFileUrl,
  ifcArrayBuffer,
}: {
  outline: Array<{ xFrac: number; yFrac: number }>;
  wallLengthsMm?: number[];
  wallHeightsMm?: number[];
  massingTiers?: VisionMassingTier[];
  buildingHeightMm: number;
  ifcFileUrl?: string;
  ifcArrayBuffer?: ArrayBuffer;
}) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('3d');
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">{t('scaffold', 'aiBimPreviewTitle')}</span>
        <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
          <button
            onClick={() => setViewMode('2d')}
            className={`px-3 py-1 font-medium transition-colors ${
              viewMode === '2d'
                ? 'bg-violet-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t('scaffold', 'aiBimPreview2d')}
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`px-3 py-1 font-medium transition-colors ${
              viewMode === '3d'
                ? 'bg-violet-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t('scaffold', 'aiBimPreview3d')}
          </button>
        </div>
      </div>
      {viewMode === '2d' ? (
        <BuildingShapeSvg
          outline={outline}
          wallLengthsMm={wallLengthsMm}
          className="w-full max-w-sm aspect-square rounded-lg border border-gray-200 bg-white"
        />
      ) : (
        <Building3DPreview
          outline={outline}
          buildingHeightMm={buildingHeightMm}
          wallLengthsMm={wallLengthsMm}
          wallHeightsMm={wallHeightsMm}
          massingTiers={massingTiers}
          ifcFileUrl={ifcFileUrl}
          ifcArrayBuffer={ifcArrayBuffer}
          className="w-full rounded-lg border border-gray-200 bg-slate-50"
          style={{ height: 320 }}
        />
      )}
    </div>
  );
}

// ─── Manual building geometry: single closed footprint, walls derived from it ───

type FootprintPoint = { xFrac: number; yFrac: number };

/** Distance between two points (mm). */
function distMm(a: FootprintPoint, b: FootprintPoint): number {
  const dx = b.xFrac - a.xFrac;
  const dy = b.yFrac - a.yFrac;
  return Math.sqrt(dx * dx + dy * dy);
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
  const { locale, t } = useI18n();

  const wallLabel = (side: string) => {
    if (side === 'north' || side === 'south' || side === 'east' || side === 'west') {
      return t('scaffold', side as 'north' | 'south' | 'east' | 'west');
    }
    if (side.startsWith('edge-')) {
      const edgeNum = parseInt(side.replace('edge-', ''), 10) + 1;
      return t('result', 'edgeLabelPrefix') + edgeNum;
    }
    return side;
  };

  // ─── Input Mode ────────────────────────────────────────
  const [inputMode, setInputMode] = useState<'drawing' | 'quick' | 'ai_bim'>('drawing');
  const [manualSubTab, setManualSubTab] = useState<'drawing' | 'quick'>('drawing');
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
    wallLengthsFromDimText?: boolean;
    heightConfidence?: 'high' | 'medium' | 'low';
    drawingType?: 'plan' | '3d' | 'elevation' | 'section';
    ifcFileUrl?: string;
    ifcArrayBuffer?: ArrayBuffer;
    isStepped?: boolean;
    obstacles?: Array<
      | { type: 'balcony' | 'ac'; vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }> }
      | { type: 'pillar'; center: { x: number; y: number } | { xFrac: number; yFrac: number }; radiusMm: number }
      | { type: 'door'; wallIndex?: number; positionMm?: number; widthMm?: number }
    >;
    dto: CreateScaffoldConfigDto;
  } | null>(null);
  const [aiBimConfirming, setAiBimConfirming] = useState(false);
  const scaffoldManagerRef = useRef<ScaffoldManager | null>(null);
  if (!scaffoldManagerRef.current) scaffoldManagerRef.current = new ScaffoldManager();

  // ─── Perimeter Model ────────────────────────────────────
  const [perimeterModel] = useState(() => new PerimeterModel());

  // ─── Form state ─────────────────────────────────────────
  const [scaffoldType, setScaffoldType] = useState<'kusabi' | 'wakugumi'>('kusabi');
  const [structureType, setStructureType] = useState<'改修工事' | 'S造' | 'RC造'>('改修工事');
  const [scaffoldWidthMm, setScaffoldWidthMm] = useState(600);
  // Kusabi-specific
  const [preferredMainTatejiMm, setPreferredMainTatejiMm] = useState(1800);
  const [topGuardHeightMm, setTopGuardHeightMm] = useState(900);
  // Wakugumi-specific
  const [frameSizeMm, setFrameSizeMm] = useState(1700);
  const [habakiCountPerSpan, setHabakiCountPerSpan] = useState(2);
  const [endStopperType, setEndStopperType] = useState<'nuno' | 'frame'>('nuno');
  const [walls, setWalls] = useState<WallState[]>([]);
  const [buildingHeightMm, setBuildingHeightMm] = useState<number | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<Array<{ x: number; y: number }>>([]);
  const [prefilled, setPrefilled] = useState(false);

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
    setScaffoldWidthMm(editConfig.scaffoldWidthMm ?? 600);
    setPreferredMainTatejiMm(editConfig.preferredMainTatejiMm ?? 1800);
    setTopGuardHeightMm(editConfig.topGuardHeightMm ?? 900);
    setFrameSizeMm(editConfig.frameSizeMm ?? 1700);
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
        };
      });
      setWalls(mapped);
      setPrefilled(true);
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
  }, [editConfigId, editConfig]);

  // ─── Fetch rules from backend ───────────────────────────
  const { data: rules, isError: rulesError, error: rulesErrorDetail } = useQuery<ScaffoldRules>({
    queryKey: ['scaffold-rules'],
    queryFn: () => scaffoldConfigsApi.getRules(),
    staleTime: 1000 * 60 * 30,
  });
  const subscriptionMessage = rulesError && (rulesErrorDetail as Error)?.message;

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
          return {
            side: w.side,
        enabled: true,
            lengthMm: w.lengthMm,
            heightMm: buildingHeightMm || 0,
        stairAccessCount: 0,
        kaidanCount: 0,
        kaidanOffsets: [],
        isMultiSegment: false,
        segments: [],
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

  // Sync building height to all enabled walls
  useEffect(() => {
    if (buildingHeightMm && buildingHeightMm > 0) {
      setWalls((prev) =>
        prev.map((w) => (w.enabled ? { ...w, heightMm: buildingHeightMm } : w)),
      );
    }
  }, [buildingHeightMm]);

  // ─── Calculate handler ──────────────────────────────────
  const handleCalculate = () => {
    if (!perimeterModel.isClosed && !prefilled) {
      alert('Please close the polygon first.\nポリゴンを閉じてください。');
      return;
    }
    if (!buildingHeightMm || buildingHeightMm <= 0) {
      alert('Please enter building height.\n建物の高さを入力してください。');
      return;
    }

    const enabledWalls: WallInput[] = walls
      .filter((w) => w.enabled && w.lengthMm > 0)
      .map((w) => ({
        side: w.side,
        wallLengthMm: w.isMultiSegment ? calcTotalFromSegments(w.segments) : w.lengthMm,
        wallHeightMm: w.heightMm || buildingHeightMm,
        stairAccessCount: w.stairAccessCount,
        kaidanCount: w.kaidanCount,
        kaidanOffsets: w.kaidanOffsets,
        ...(w.isMultiSegment && w.segments.length > 0
          ? { isMultiSegment: true, segments: w.segments }
          : {}),
        ...(w.scaffoldWidthMm != null && { scaffoldWidthMm: w.scaffoldWidthMm }),
    }));

    if (enabledWalls.length === 0) {
      alert('No enabled wall segments.\n有効な壁セグメントがありません。');
      return;
    }

    // Validate minimum wall lengths (backend requires >= 600mm)
    const tooShort = enabledWalls.filter(w => w.wallLengthMm < 600);
    if (tooShort.length > 0) {
      alert(
        `Some walls are too short (min 600mm):\n${tooShort.map(w => `${w.side}: ${w.wallLengthMm}mm`).join('\n')}\n\nPlease enter real wall dimensions in mm.\n壁の長さは最低600mm必要です。`,
      );
      return;
    }

    // Validate minimum wall heights (backend requires >= 1000mm)
    const tooLow = enabledWalls.filter(w => w.wallHeightMm < 1000);
    if (tooLow.length > 0) {
      alert(
        `Some walls have invalid height (min 1000mm):\n${tooLow.map(w => `${w.side}: ${w.wallHeightMm}mm`).join('\n')}\n\n壁の高さは最低1000mm必要です。`,
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
      ...(scaffoldType === 'kusabi' && {
        preferredMainTatejiMm,
        topGuardHeightMm,
      }),
      ...(scaffoldType === 'wakugumi' && {
        frameSizeMm,
        habakiCountPerSpan,
        endStopperType,
      }),
      ...(polygonVertices.length >= 3 && polygonVertices.length === enabledWalls.length && {
        buildingOutline: polygonVertices.map((v) => ({ xFrac: v.x, yFrac: v.y })),
        pattankoCornerCount: countPattankoCorners(polygonVertices),
      }),
    };
    calculateMutation.mutate({ dto, configId: editConfigId });
  };

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
        topGuardHeightMm: qConfig.topGuardHeightMm,
      }),
      ...(qConfig.scaffoldType === 'wakugumi' && {
        frameSizeMm: qConfig.frameSizeMm,
        habakiCountPerSpan: qConfig.habakiCountPerSpan,
        endStopperType: qConfig.endStopperType,
      }),
    };
    calculateMutation.mutate({ dto, configId: null });
  };

  return (
    <div className="min-h-screen bg-gray-50" suppressHydrationWarning>
        {/* Header */}
      <div className="max-w-[1600px] mx-auto px-4 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Calculator className="h-7 w-7 text-blue-600" />
            {t('scaffold', 'title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{t('scaffold', 'subtitle')}</p>

          {/* ─── Mode Selector (2 sections) ─── */}
          {!editConfigId && (
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setInputMode('drawing')}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                  inputMode !== 'ai_bim'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <PenTool className="h-4 w-4" />
                {t('scaffoldExtra', 'manualInput')}
              </button>
              <button
                onClick={() => setInputMode('ai_bim')}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                  inputMode === 'ai_bim'
                    ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <ScanLine className="h-4 w-4" />
                {t('scaffold', 'aiBimMode')}
              </button>
            </div>
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
          AI BIM MODE — Vision-to-BIM upload
         ═══════════════════════════════════════════════════════ */}
      {inputMode === 'ai_bim' && !editConfigId && (
        <div className="max-w-[1200px] mx-auto px-4 pb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-violet-600" />
              {t('scaffold', 'aiBimModeTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {aiBimPreview
                ? t('scaffold', 'aiBimModeReady')
                : t('scaffold', 'aiBimModeDescription')}
            </p>
            {!aiBimPreview && (
              <p className="text-xs text-violet-700/90 -mt-4 mb-6">
                {t('scaffold', 'aiBimColorSamplingHint')}
              </p>
            )}
            {!aiBimPreview && (
            <>
            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-violet-300 rounded-xl cursor-pointer bg-violet-50/50 hover:bg-violet-50 transition-colors">
              <Upload className="h-10 w-10 text-violet-500 mb-2" />
              <span className="text-sm font-medium text-violet-700 mb-1">{t('scaffold', 'aiBimUploadCta')}</span>
              <span className="text-xs text-gray-500">{t('scaffold', 'aiBimAcceptedFormats')}</span>
              <input
                type="file"
                className="hidden"
                accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.dxf,.dwg,.jww,.ifc,.pdf,image/png,image/jpeg,image/gif,image/webp,image/bmp,application/dxf,application/pdf"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setAiBimError(null);
                  setAiBimUploading(true);
                  try {
                    const isIfc = file.name.toLowerCase().endsWith('.ifc');
                    let ifcArrayBuffer: ArrayBuffer | undefined;
                    if (isIfc) {
                      ifcArrayBuffer = await file.arrayBuffer();
                    }
                    const raw = isIfc
                      ? await visionBimApi.fromIfc(file)
                      : await visionBimApi.analyze(file);
                    let bimFacadeColors: CreateScaffoldConfigDto['bimFacadeColors'];
                    if (!isIfc && isRasterImageUpload(file)) {
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
                    const wallLengthsMm = isIfc
                      ? footprint.wallLengthsMm
                      : (correctWallLengthsMm(footprint.wallLengthsMm) ?? footprint.wallLengthsMm);
                    // If AI returned pixel-scale wall heights (all < 1800mm), treat buildingHeightMm as authoritative
                    // and ignore per-wall heights (they'll be overridden by the sanitizer on submit anyway).
                    const wallHeightsMmRaw = footprint.wallHeightsMm;
                    const wallHeightsMm = Array.isArray(wallHeightsMmRaw) && wallHeightsMmRaw.length > 0
                      && wallHeightsMmRaw.every((h) => h < 1800)
                      ? undefined
                      : wallHeightsMmRaw;
                    const { walls, buildingOutline } = manager.injectFootprintAndGetWalls(
                      footprint.vertices,
                      footprint.buildingHeightMm,
                      refMm,
                      { wallLengthsMm, wallHeightsMm },
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
                    const defaults = getAiBimDefaults();
                    const scaffoldType = footprint.scaffoldTypeHint ?? 'kusabi';
                    const frameSize = scaffoldType === 'wakugumi' ? (footprint.frameSizeMm ?? 1800) : undefined;
                    const dto: CreateScaffoldConfigDto = {
                      projectId: 'default-project',
                      mode: 'manual',
                      scaffoldType,
                      structureType: '改修工事',
                      walls,
                      scaffoldWidthMm: defaults.scaffoldWidthMm,
                      preferredMainTatejiMm: defaults.preferredMainTatejiMm,
                      topGuardHeightMm: defaults.topGuardHeightMm,
                      ...(scaffoldType === 'wakugumi' && frameSize != null && { frameSizeMm: frameSize }),
                      buildingOutline,
                      ...(normalizedMassingTiers && normalizedMassingTiers.length > 0 && { massingTiers: normalizedMassingTiers }),
                      ...(obstacles && obstacles.length > 0 && { obstacles }),
                      ...(bimFacadeColors && { bimFacadeColors }),
                      ...(footprint.ifcFileUrl && { ifcFileUrl: footprint.ifcFileUrl }),
                    };
                    const isStepped = Array.isArray(wallHeightsMm) && wallHeightsMm.length > 0
                      && new Set(walls.map((w) => w.wallHeightMm)).size > 1;
                    setAiBimPreview({
                      buildingHeightMm: footprint.buildingHeightMm,
                      walls,
                      buildingOutline,
                      massingTiers: normalizedMassingTiers,
                      scaffoldType,
                      frameSizeMm: frameSize,
                      wallLengthsFromDimText: footprint.wallLengthsFromDimText,
                      heightConfidence: footprint.heightConfidence,
                      drawingType: footprint.drawingType,
                      ifcFileUrl: footprint.ifcFileUrl,
                      ifcArrayBuffer,
                      isStepped,
                      obstacles,
                      dto,
                    });
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                    <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                      <Check className="h-5 w-5" />
                      {t('scaffold', 'aiBimExtractedComplete')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAiBimPreview(null); setAiBimError(null); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t('scaffold', 'aiBimUploadAnother')}
                  </button>
                </div>
                <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/50 space-y-4">
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
                              <td className="py-2 px-3 text-gray-800">{t('scaffold', 'aiBimWallLabel').replace('{index}', String(i + 1))}</td>
                              <td className="py-2 px-3 text-right font-mono text-gray-700">{w.wallLengthMm.toLocaleString()}</td>
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
                  <BuildingPreviewPanel
                    outline={aiBimPreview.buildingOutline}
                    wallLengthsMm={aiBimPreview.walls.map((w) => w.wallLengthMm)}
                    wallHeightsMm={aiBimPreview.isStepped ? aiBimPreview.walls.map((w) => w.wallHeightMm) : undefined}
                    massingTiers={aiBimPreview.massingTiers}
                    buildingHeightMm={aiBimPreview.buildingHeightMm}
                    ifcFileUrl={aiBimPreview.ifcFileUrl}
                    ifcArrayBuffer={aiBimPreview.ifcArrayBuffer}
                  />
                  <div className="grid grid-cols-1 gap-4">
                    {/* Scaffold type + width + post/frame size (AI BIM overrides) */}
                    <div className="rounded-lg border border-violet-200 bg-white p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-violet-700">{t('scaffold', 'aiBimConditionsTitle')}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Type */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">{t('scaffold', 'scaffoldTypeLabel')}</label>
                          <select
                            value={aiBimPreview.scaffoldType}
                            onChange={(e) => {
                              const nextType = e.target.value as 'kusabi' | 'wakugumi';
                              const nextFrameSize = nextType === 'wakugumi'
                                ? (aiBimPreview.frameSizeMm ?? 1800)
                                : undefined;
                              setAiBimPreview({
                                ...aiBimPreview,
                                scaffoldType: nextType,
                                frameSizeMm: nextFrameSize,
                                dto: {
                                  ...aiBimPreview.dto,
                                  scaffoldType: nextType,
                                  ...(nextType === 'wakugumi'
                                    ? { frameSizeMm: nextFrameSize, preferredMainTatejiMm: undefined }
                                    : {
                                        frameSizeMm: undefined,
                                        preferredMainTatejiMm: getAiBimDefaults().preferredMainTatejiMm,
                                      }),
                                },
                              });
                            }}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500"
                          >
                            <option value="kusabi">{t('scaffold', 'kusabiType')}</option>
                            <option value="wakugumi">{t('scaffold', 'wakugumiType')}</option>
                          </select>
                        </div>
                        {/* Width */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">{t('scaffold', 'aiBimScaffoldWidthHeader')}</label>
                          <select
                            value={aiBimPreview.dto.scaffoldWidthMm}
                            onChange={(e) => {
                              const width = Number(e.target.value) || 600;
                              setAiBimPreview({
                                ...aiBimPreview,
                                dto: { ...aiBimPreview.dto, scaffoldWidthMm: width },
                              });
                            }}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500"
                          >
                            {[600, 900, 1200].map((w) => (
                              <option key={w} value={w}>
                                {w}mm
                              </option>
                            ))}
                          </select>
                        </div>
                        {/* Post / frame size */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            {aiBimPreview.scaffoldType === 'wakugumi' ? '建枠サイズ' : '支柱サイズ'}
                          </label>
                          {aiBimPreview.scaffoldType === 'wakugumi' ? (
                            <select
                              value={aiBimPreview.frameSizeMm ?? 1800}
                              onChange={(e) => {
                                const fs = Number(e.target.value) || 1800;
                                setAiBimPreview({
                                  ...aiBimPreview,
                                  frameSizeMm: fs,
                                  dto: { ...aiBimPreview.dto, frameSizeMm: fs },
                                });
                              }}
                              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500"
                            >
                              {[1700, 1800, 1900].map((v) => (
                                <option key={v} value={v}>
                                  {v}mm
                                </option>
                              ))}
                            </select>
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
                              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-500"
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

                    {/* Stairs per wall */}
                  </div>
                  <button
                    type="button"
                    disabled={aiBimConfirming}
                    onClick={async () => {
                      if (!aiBimPreview) return;
                      setAiBimConfirming(true);
                      try {
                        const outline = aiBimPreview.buildingOutline;
                        // Auto-decompose walls for stepped/setback buildings while
                        // filtering to exterior runs per tier.
                        let finalWalls = aiBimPreview.dto.walls;
                        let finalMassingTiers = aiBimPreview.massingTiers;
                        if (aiBimPreview.massingTiers && aiBimPreview.massingTiers.length > 0) {
                          const { decomposeTierWalls } = await import('@/lib/tier-wall-decomposer');
                          const decomposed = decomposeTierWalls(
                            aiBimPreview.dto.walls,
                            aiBimPreview.massingTiers,
                            aiBimPreview.buildingHeightMm,
                          );
                          if (decomposed.massingTiers && decomposed.massingTiers.length > 0) {
                            finalMassingTiers = decomposed.massingTiers;
                          }
                          if (decomposed.walls.length > 0 && decomposed.walls !== aiBimPreview.dto.walls) {
                            finalWalls = decomposed.walls;
                          }
                        }
                        // When walls still have uniform max height but isStepped,
                        // ensure per-wall heights from the preview are preserved
                        if (aiBimPreview.isStepped && finalWalls === aiBimPreview.dto.walls) {
                          finalWalls = aiBimPreview.walls.map((pw) => {
                            const match = finalWalls.find((fw) => fw.side === pw.side);
                            return match
                              ? { ...match, wallHeightMm: pw.wallHeightMm }
                              : { ...pw };
                          });
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
                        const dto = {
                          ...aiBimPreview.dto,
                          walls: sanitizedWalls,
                          ...(finalMassingTiers && finalMassingTiers.length > 0 && { massingTiers: finalMassingTiers }),
                          pattankoCornerCount: outline && outline.length >= 3 ? countPattankoCorners(outline) : undefined,
                          ...(aiBimPreview.ifcFileUrl && { ifcFileUrl: aiBimPreview.ifcFileUrl }),
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
          MANUAL INPUT — Drawing Upload + Quick Shape Builder
         ═══════════════════════════════════════════════════════ */}
      {(inputMode !== 'ai_bim' || editConfigId) && (<>
      {/* Sub-tab selector */}
      {!editConfigId && (
        <div className="max-w-[1600px] mx-auto px-4 mb-4">
          <div className="inline-flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => { setManualSubTab('drawing'); setInputMode('drawing'); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                manualSubTab === 'drawing'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              {t('scaffoldExtra', 'drawingUpload')}
            </button>
            <button
              onClick={() => { setManualSubTab('quick'); setInputMode('quick'); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                manualSubTab === 'quick'
                  ? 'bg-white text-green-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              {t('scaffoldExtra', 'quickBuilder')}
            </button>
          </div>
        </div>
      )}

      {/* Quick Shape Builder */}
      {manualSubTab === 'quick' && !editConfigId && (
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

      {/* Drawing Upload — Perimeter Tracer */}
      {(manualSubTab === 'drawing' || editConfigId) && (<>
      <div className="max-w-[1600px] mx-auto px-4 mb-6">
        <PerimeterTracer
          perimeterModel={perimeterModel}
          onWallsDetected={handleWallsDetected}
          onSegmentEdit={handleSegmentEdit}
          externalWallLengths={walls.map(w => w.lengthMm)}
          buildingHeightMm={buildingHeightMm}
          onBuildingHeightChange={setBuildingHeightMm}
        />
          </div>

      {/* ═══════════════════════════════════════════════════════
          SCAFFOLD SETTINGS + WALL CONFIG (shown when walls exist)
         ═══════════════════════════════════════════════════════ */}
      {walls.length > 0 && (
        <div className="max-w-[1600px] mx-auto px-4 pb-8">

        {/* Building & Scaffold Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            {t('scaffold', 'buildingSettings')}
          </h2>

            {/* Scaffold Type Selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('scaffoldExtra', 'scaffoldType')}
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setScaffoldType('kusabi')}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    scaffoldType === 'kusabi'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div>{t('scaffold', 'kusabiType')}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setScaffoldType('wakugumi')}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    scaffoldType === 'wakugumi'
                      ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div>{t('scaffold', 'wakugumiType')}</div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Structure Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('scaffold', 'structureType')}
              </label>
              <select
                value={structureType}
                onChange={(e) => setStructureType(e.target.value as '改修工事' | 'S造' | 'RC造')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="改修工事">{t('scaffold', 'structureTypeRenovation')} (1.25x)</option>
                <option value="S造">{t('scaffold', 'structureTypeSteel')} (1.0x)</option>
                <option value="RC造">{t('scaffold', 'structureTypeConcrete')} (0.9x)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">{t('scaffold', 'structureTypeHint')}</p>
            </div>

            {/* Scaffold Width */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('scaffold', 'scaffoldWidth')}
              </label>
              <select
                value={scaffoldWidthMm}
                onChange={(e) => setScaffoldWidthMm(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(rules?.scaffoldWidths || [
                  { value: 600, label: '600mm' },
                  { value: 900, label: '900mm' },
                  { value: 1200, label: '1200mm' },
                ]).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* ─── Kusabi-specific fields ─── */}
            {scaffoldType === 'kusabi' && (
              <>
                {/* Main Tateji */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffold', 'postSize')}
                  </label>
                  <select
                    value={preferredMainTatejiMm}
                    onChange={(e) => setPreferredMainTatejiMm(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {(rules?.mainTatejiOptions || [
                      { value: 1800, label: '1800mm' },
                      { value: 2700, label: '2700mm' },
                      { value: 3600, label: '3600mm' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Top Guard */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffold', 'topGuard')}
                  </label>
                  <select
                    value={topGuardHeightMm}
                    onChange={(e) => setTopGuardHeightMm(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {(rules?.topGuardOptions || [
                      { value: 900, label: '900mm' },
                      { value: 1350, label: '1350mm' },
                      { value: 1800, label: '1800mm' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* ─── Wakugumi-specific fields ─── */}
            {scaffoldType === 'wakugumi' && (
              <>
                {/* Frame Size (建枠サイズ) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffoldExtra', 'frameSize')}
                  </label>
                  <select
                    value={frameSizeMm}
                    onChange={(e) => setFrameSizeMm(Number(e.target.value))}
                    className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                  >
                    {(rules?.wakugumi?.frameSizeOptions || [
                      { value: 1700, label: '1700mm (標準)' },
                      { value: 1800, label: '1800mm' },
                      { value: 1900, label: '1900mm' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">{t('scaffoldExtra', 'frameSizeHint')}</p>
                </div>

                {/* Habaki Count (巾木枚数) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffoldExtra', 'habakiCount')}
                  </label>
                  <select
                    value={habakiCountPerSpan}
                    onChange={(e) => setHabakiCountPerSpan(Number(e.target.value))}
                    className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                  >
                    {(rules?.wakugumi?.habakiCountOptions || [
                      { value: 1, label: '1枚 (片面)' },
                      { value: 2, label: '2枚 (両面)' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* End Stopper Type (端部タイプ) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('scaffoldExtra', 'endStopper')}
                  </label>
                  <select
                    value={endStopperType}
                    onChange={(e) => setEndStopperType(e.target.value as 'nuno' | 'frame')}
                    className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                  >
                    {(rules?.wakugumi?.endStopperTypeOptions || [
                      { value: 'nuno', label: '布材タイプ (端部布材)' },
                      { value: 'frame', label: '枠タイプ (妻側枠)' },
                    ]).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Wall Configuration */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">{t('scaffold', 'wallConfig')}</h2>

          {/* Quick Height Estimator */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs font-medium text-blue-800 mb-2">
              📐 {t('scaffold', 'quickHeightEstimate')}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '1F (3,900mm)', value: 3900 },
                { label: '2F (6,900mm)', value: 6900 },
                { label: '3F (9,900mm)', value: 9900 },
                { label: '4F (12,900mm)', value: 12900 },
                { label: '5F (15,900mm)', value: 15900 },
                { label: '6F+', value: 0 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    if (preset.value === 0) {
                      const floors = prompt(t('scaffold', 'enterFloorCount') || 'Enter number of floors (6-20):', '6');
                      if (floors) {
                        const n = parseInt(floors, 10);
                        if (n >= 1 && n <= 50) {
                          const height = 3300 + (n - 1) * 3000 + 900;
                            setBuildingHeightMm(height);
                            setWalls((prev) => prev.map((w) => (w.enabled ? { ...w, heightMm: height } : w)));
                        }
                      }
                    } else {
                        setBuildingHeightMm(preset.value);
                        setWalls((prev) => prev.map((w) => (w.enabled ? { ...w, heightMm: preset.value } : w)));
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-white border border-blue-300 rounded-lg hover:bg-blue-100 text-blue-700 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-blue-500 mt-1.5">
              {t('scaffold', 'quickHeightNote')}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">
              {t('scaffold', 'perSideSection') || '各辺：足場幅・階段'}
            </p>
            {walls.map((wall, i) => (
              <div
                key={wall.side}
                className={`rounded-lg border p-4 transition-all ${
                  wall.enabled
                    ? 'border-blue-200 bg-blue-50/50'
                    : 'border-gray-200 bg-gray-50 opacity-60'
                }`}
              >
                <div className="flex items-center gap-4 flex-wrap">
                  {/* Enable checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer min-w-[80px]">
                    <input
                      type="checkbox"
                      checked={wall.enabled}
                      onChange={(e) => updateWall(i, { enabled: e.target.checked })}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="font-semibold text-gray-800">{wallLabel(wall.side)}</span>
                  </label>

                  {/* Per side: scaffold width & stairs (足場幅・階段) */}
                  <div className="flex items-center gap-2 min-w-[100px]">
                    <label className="text-sm text-gray-600 whitespace-nowrap">{t('scaffold', 'scaffoldWidth') || '足場幅'}</label>
                    <select
                      value={wall.scaffoldWidthMm ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateWall(i, { scaffoldWidthMm: v ? Number(v) : undefined });
                      }}
                      disabled={!wall.enabled}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <option value="">{scaffoldWidthMm}mm</option>
                      {[600, 900, 1200].filter((w) => w !== scaffoldWidthMm).map((w) => (
                        <option key={w} value={w}>{w}mm</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 min-w-[100px]">
                    <label className="text-sm text-gray-600 whitespace-nowrap">{t('scaffold', 'stairsPerSide') || '階段'}</label>
                    <select
                      value={wall.stairAccessCount ?? 0}
                      onChange={(e) => updateWall(i, { stairAccessCount: Number(e.target.value) || 0 })}
                      disabled={!wall.enabled}
                      className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {[0, 1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>

                  {/* Wall Length */}
                    <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600 whitespace-nowrap">{t('scaffold', 'wallLength')}</label>
                      <input
                        type="number"
                        value={(wall.isMultiSegment && wall.segments.length > 0
                          ? calcTotalFromSegments(wall.segments)
                          : wall.lengthMm) || ''}
                        onChange={(e) => {
                          if (!wall.isMultiSegment) {
                            updateWall(i, { lengthMm: Number(e.target.value) || 0 });
                          }
                        }}
                        disabled={!wall.enabled || wall.isMultiSegment}
                        readOnly={wall.isMultiSegment}
                        placeholder="0"
                        className={`w-32 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${
                          wall.isMultiSegment ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-gray-300'
                        }`}
                        min={600}
                        step={100}
                      />
                      <span className="text-sm text-gray-500">mm</span>
                        <span className="text-xs text-gray-400 min-w-[50px]">
                          {wall.lengthMm > 0 ? `${(wall.lengthMm / 1000).toFixed(2)}m` : ''}
                        </span>
                      {wall.isMultiSegment && (
                        <span className="text-xs text-orange-500" title="Auto-calculated from segments">⚡</span>
                      )}
                    </div>
                  </div>

                  {/* Wall Height */}
                    <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600 whitespace-nowrap">{t('scaffold', 'wallHeight')}</label>
                      <input
                        type="number"
                        value={wall.heightMm || ''}
                        onChange={(e) => updateWall(i, { heightMm: Number(e.target.value) || 0 })}
                        disabled={!wall.enabled}
                        placeholder="0"
                        className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        min={1000}
                        step={100}
                      />
                      <span className="text-sm text-gray-500">mm</span>
                        <span className="text-xs text-gray-400 min-w-[50px]">
                          {wall.heightMm > 0 ? `${(wall.heightMm / 1000).toFixed(1)}m` : ''}
                        </span>
                    </div>
                  </div>

                  <span className="text-xs text-gray-400 self-center">
                    {wall.scaffoldWidthMm ? '' : `幅=${scaffoldWidthMm}mm`}
                  </span>
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

                {/* Kaidan Placement Section */}
                  {wall.enabled &&
                    (wall.isMultiSegment ? calcTotalFromSegments(wall.segments) : wall.lengthMm) > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200 w-full">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-medium text-gray-700">
                        {t('scaffold', 'kaidanPlacement') || 'Kaidan Placement'}
                      </label>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600 whitespace-nowrap">
                          {t('scaffold', 'kaidanCount') || 'Number of accesses:'}
                        </label>
                        <select
                          value={wall.kaidanCount || 0}
                          onChange={(e) => {
                            const count = Number(e.target.value) || 0;
                            const currentOffsets = wall.kaidanOffsets || [];
                            let newOffsets: number[];
                            if (count === 0) {
                              newOffsets = [];
                            } else if (count > currentOffsets.length) {
                              newOffsets = [...currentOffsets];
                              for (let j = currentOffsets.length; j < count; j++) {
                                const position = Math.round((wall.lengthMm / (count + 1)) * (j + 1));
                                newOffsets.push(Math.round(position / 100) * 100);
                              }
                            } else {
                              newOffsets = currentOffsets.slice(0, count);
                            }
                            updateWall(i, {
                              kaidanCount: count,
                              kaidanOffsets: newOffsets,
                              stairAccessCount: count,
                            });
                          }}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
                        >
                          {[0, 1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                          ))}
                        </select>
                      </div>
                    </div>

                        {wall.kaidanCount > 0 &&
                          (wall.kaidanOffsets || []).map((offset, kaidanIdx) => (
                      <div key={kaidanIdx} className="mb-4 last:mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-medium text-gray-600">
                            {t('scaffold', 'kaidan') || 'Kaidan'} {kaidanIdx + 1}:
                          </label>
                                <span className="text-xs text-gray-500">{offset.toLocaleString()}mm</span>
                        </div>
                        {(() => {
                                const effectiveLength =
                                  wall.isMultiSegment && wall.segments.length > 0
                            ? calcTotalFromSegments(wall.segments)
                            : wall.lengthMm;
                          return (
                            <>
                              <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                                <span>0mm</span>
                                <span>{effectiveLength.toLocaleString()}mm</span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={effectiveLength}
                                step={100}
                                value={offset}
                                onChange={(e) => {
                                  const raw = Number(e.target.value) || 0;
                                  const snapped = Math.round(raw / 100) * 100;
                                  const newOffsets = [...(wall.kaidanOffsets || [])];
                                  newOffsets[kaidanIdx] = snapped;
                                  updateWall(i, { kaidanOffsets: newOffsets });
                                }}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                style={{
                                        background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(offset / effectiveLength) * 100}%, #e5e7eb ${(offset / effectiveLength) * 100}%, #e5e7eb 100%)`,
                                }}
                              />
                            </>
                          );
                        })()}
                        <div className="mt-1 text-[10px] text-gray-400 italic">
                                {t('scaffold', 'kaidanPlacementHint') ||
                                  'Drag to position - kaidan will be placed in 2 spans closest to this position'}
                        </div>
                      </div>
                    ))}

                    {wall.kaidanCount === 0 && (
                      <p className="text-xs text-gray-400 italic">
                            {t('scaffold', 'selectKaidanCount') ||
                              'Select number of kaidan accesses above to position them'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

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
      </>)}
    </div>
  );
}
