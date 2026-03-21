'use client';

import { useRef, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, FileText, FileCode, Box, Download, Info, Plus, Minus, Camera } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { WallCalculationResult, CalculatedComponent, BuildingMassingTier } from '@/lib/api/scaffold-configs';
import { scaffoldConfigsApi } from '@/lib/api/scaffold-configs';
import html2canvas from 'html2canvas';
import {
  loadScaffoldTextures,
  addRealisticPost,
  addRealisticPlank,
  addRealisticNunoBar,
  addRealisticHabaki,
  addBasePlate,
  addCoupler,
  BIM_COLORS,
} from '@/lib/scaffold-3d-components';
import { buildFootprintPolygonXZ } from '@/lib/scaffold-footprint-polygon';
import { normaliseMassingTierVerticesToGroundFootprint } from '@/lib/bim-tier-footprint-normalize';
import { bimHexToNumber } from '@/lib/bim-facade-colors';

/**
 * 3D Scaffold View — Closed Polygon
 * Footprint vertices come from `buildFootprintPolygonXZ` (shared with plan view):
 * walk stored outline directions with per-wall lengths; closing edge is the chord back
 * to the first corner (no overwriting vertex 0, which broke the last wall in BIM hexes).
 * Span generation uses correct post reuse (N spans → N+1 post positions). One shared
 * vertical post per polygon vertex closes the corners visually.
 */

const PIPE_R = 0.024;
const PIPE_SEG = 10;
/** Ground level (y=0): building footprint and physical ground. Scaffold working levels are above this. */
const GROUND_Y = 0;
const LEVEL_H_KUSABI = 1.8;
const JACK_H = 0.3;
// Corner detail base rule on source wall: 300mm overrun + 600mm corner span
const CORNER_OVERRUN_M = 0.3;
const CORNER_TURN_SPAN_M = 0.6;
/** Offset from building wall to inner posts (always 300mm). */
const WALL_TO_INNER_POSTS_MM = 300;
/** Spans (planks) can overrun toward the wall by this amount (m). */
const SPAN_OVERRUN_TO_WALL_M = 0.3;

/** Anchi (plank) layout by scaffold width — matches backend ANCHI_LAYOUT_BY_WIDTH. */
const ANCHI_LAYOUT_BY_WIDTH: Record<number, { full: number; half: number; fullWidthMm: number; halfWidthMm?: number }> = {
  600:  { full: 1, half: 0, fullWidthMm: 500 },
  900:  { full: 1, half: 1, fullWidthMm: 500, halfWidthMm: 240 },
  1200: { full: 2, half: 0, fullWidthMm: 500 },
};
/** Height of scaffold working level lv (1-based): GROUND_Y + JACK_H + lv * LEVEL_H. Not building floor level. */
type ViewMode = 'all' | 'wall';

// Technical palette (distinct per component for estimation/quotation)
const C_TECH = {
  // User-requested color scheme for 3D clarity
  jack: 0x111827,      // black
  brace: 0x2563eb,     // blue
  tesuri: 0x16a34a,    // green
  habaki: 0xef4444,    // red
  plank: 0xf5c842,     // yellow
  // Remaining components
  post: 0x0f172a,
  shitasan: 0x0e7490,
  yokoji: 0x15803d,
  topGuard: 0x6d28d9,
  frame: 0x4f46e5,
  endStopper: 0x7c3aed,
  stair: 0x047857,
};
/** Buragetto (bracket) sections — always blue for visual verification */
const C_BRACKET = 0x2563eb;
// Professional BIM palette — matches EK Scaffold Design tender renderings
const C = {
  post:       BIM_COLORS.pipe,
  plank:      BIM_COLORS.plank,
  tesuri:     BIM_COLORS.tesuri,
  brace:      BIM_COLORS.pipeDark,
  ecoPallet:  BIM_COLORS.ecoPallet,
  ground:     BIM_COLORS.ground,
  bg:         0xf0f0f0,
  ambient:    0xffffff,
  dirLight:   0xffffff,
};

// Per-wall accent colors (for edge/click hint only)
const WALL_COLORS_HEX = [
  0x3b82f6, 0xf59e0b, 0x10b981, 0xec4899,
  0x8b5cf6, 0xef4444, 0x06b6d4, 0x84cc16,
  0xf97316, 0x6366f1,
];

// Span size (mm) → distinct plank + habaki colour per span length
const SPAN_COLORS: Record<number, number> = {
  600: 0x3b82f6,   // blue
  900: 0x10b981,   // green
  1200: 0xf59e0b,  // amber
  1500: 0xef4444,  // red
  1800: 0x8b5cf6,  // purple
};
const STANDARD_SPANS = [600, 900, 1200, 1500, 1800];

// ── Performance limits ──────────────────────────────────────
// Each span-level creates ~20 mesh objects.  Beyond this threshold
// we cap spans per wall so the browser stays responsive.
const MAX_TOTAL_MESHES = 60_000;           // ≈ 3 000 span-levels
const MESHES_PER_SPAN_LEVEL = 20;
const MAX_SPAN_LEVELS = Math.floor(MAX_TOTAL_MESHES / MESHES_PER_SPAN_LEVEL);

type PointXZ = { x: number; z: number };

function lineIntersectionXZ(a1: PointXZ, a2: PointXZ, b1: PointXZ, b2: PointXZ): PointXZ | null {
  const dax = a2.x - a1.x;
  const daz = a2.z - a1.z;
  const dbx = b2.x - b1.x;
  const dbz = b2.z - b1.z;
  const det = dax * dbz - daz * dbx;
  if (Math.abs(det) < 1e-9) return null;
  const dx = b1.x - a1.x;
  const dz = b1.z - a1.z;
  const t = (dx * dbz - dz * dbx) / det;
  return { x: a1.x + t * dax, z: a1.z + t * daz };
}

function shiftedPointXZ(p: PointXZ, n: PointXZ, offset: number): PointXZ {
  return { x: p.x + n.x * offset, z: p.z + n.z * offset };
}

function edgeEndpointsXZ(verts: PointXZ[], edgeIdx: number, isOpen: boolean): [PointXZ, PointXZ] {
  const start = verts[edgeIdx]!;
  const end = isOpen ? verts[edgeIdx + 1]! : verts[(edgeIdx + 1) % verts.length]!;
  return [start, end];
}

function edgeNormalXZ(verts: PointXZ[], edgeIdx: number, normalSign: number, isOpen: boolean): PointXZ {
  const [a, b] = edgeEndpointsXZ(verts, edgeIdx, isOpen);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return { x: 0, z: 0 };
  return {
    x: normalSign * (-dz / len),
    z: normalSign * (dx / len),
  };
}

function buildOffsetPathXZ(
  verts: PointXZ[],
  edgeCount: number,
  normalSign: number,
  offset: number,
  isOpen: boolean,
): PointXZ[] {
  if (edgeCount <= 0 || verts.length < 2) return [];
  const vertexCount = isOpen
    ? Math.min(verts.length, edgeCount + 1)
    : Math.min(verts.length, edgeCount);
  if (vertexCount < 2) return [];
  const pts = verts.slice(0, vertexCount);
  const miterLimit = Math.max(offset * 6, 0.05);
  const getNormal = (edgeIdx: number) => edgeNormalXZ(pts, edgeIdx, normalSign, isOpen);

  if (isOpen) {
    const out: PointXZ[] = [];
    const firstNormal = getNormal(0);
    out.push(shiftedPointXZ(pts[0]!, firstNormal, offset));
    for (let i = 1; i < pts.length - 1; i++) {
      const prevEdge = i - 1;
      const nextEdge = i;
      const prevNormal = getNormal(prevEdge);
      const nextNormal = getNormal(nextEdge);
      const [p1, p2] = edgeEndpointsXZ(pts, prevEdge, true);
      const [n1, n2] = edgeEndpointsXZ(pts, nextEdge, true);
      const hit = lineIntersectionXZ(
        shiftedPointXZ(p1, prevNormal, offset),
        shiftedPointXZ(p2, prevNormal, offset),
        shiftedPointXZ(n1, nextNormal, offset),
        shiftedPointXZ(n2, nextNormal, offset),
      );
      const fallback = shiftedPointXZ(pts[i]!, {
        x: (prevNormal.x + nextNormal.x) / 2 || nextNormal.x || prevNormal.x,
        z: (prevNormal.z + nextNormal.z) / 2 || nextNormal.z || prevNormal.z,
      }, offset);
      if (!hit || Math.hypot(hit.x - pts[i]!.x, hit.z - pts[i]!.z) > miterLimit) out.push(fallback);
      else out.push(hit);
    }
    const lastNormal = getNormal(edgeCount - 1);
    out.push(shiftedPointXZ(pts[pts.length - 1]!, lastNormal, offset));
    return out;
  }

  return pts.map((v, i) => {
    const prevEdge = (i - 1 + edgeCount) % edgeCount;
    const nextEdge = i % edgeCount;
    const prevNormal = getNormal(prevEdge);
    const nextNormal = getNormal(nextEdge);
    const [p1, p2] = edgeEndpointsXZ(pts, prevEdge, false);
    const [n1, n2] = edgeEndpointsXZ(pts, nextEdge, false);
    const hit = lineIntersectionXZ(
      shiftedPointXZ(p1, prevNormal, offset),
      shiftedPointXZ(p2, prevNormal, offset),
      shiftedPointXZ(n1, nextNormal, offset),
      shiftedPointXZ(n2, nextNormal, offset),
    );
    const fallback = shiftedPointXZ(v, {
      x: (prevNormal.x + nextNormal.x) / 2 || nextNormal.x || prevNormal.x,
      z: (prevNormal.z + nextNormal.z) / 2 || nextNormal.z || prevNormal.z,
    }, offset);
    if (!hit || Math.hypot(hit.x - v.x, hit.z - v.z) > miterLimit) return fallback;
    return hit;
  });
}

/** Return the max spans we can afford per wall so the total stays under budget. */
function computeSpanCaps(walls: WallCalculationResult[], levelH: number) {
  let totalSpanLevels = 0;
  const infos = walls.map(w => {
    const levels = w.levelCalc?.fullLevels ?? 1;
    const spans = w.spans?.length ?? 0;
    const sl = spans * levels;
    totalSpanLevels += sl;
    return { spans, levels, sl };
  });

  if (totalSpanLevels <= MAX_SPAN_LEVELS) {
    // Everything fits — no capping needed
    return { caps: infos.map(i => i.spans), simplified: false, totalSpanLevels };
  }

  // Proportional cap: each wall gets a share of the budget proportional to its original count
  const ratio = MAX_SPAN_LEVELS / totalSpanLevels;
  const caps = infos.map(i => {
    const maxSpans = Math.max(3, Math.floor(i.spans * ratio)); // at least 3 spans
    return Math.min(maxSpans, i.spans);
  });
  return { caps, simplified: true, totalSpanLevels };
}

export interface Scaffold3DViewProps {
  result: any;
  totalLevels?: number;
  complianceMode?: 'default' | 'ai_bim';
  /** When true, use distinct colors per component (支柱/ブレス/手摺/踏板 etc.) for estimation clarity */
  technicalQuotationMode?: boolean;
}

const COMPONENT_INFO: Record<string, { nameJp: string; description: string }> = {
  post: { nameJp: '支柱（タテジ）', description: 'くさび式足場の垂直材。建物面に沿って一定間隔で立て、レベルごとに継ぎ足します。' },
  tateji: { nameJp: '支柱（タテジ）', description: '垂直方向の荷重を支える主要な部材です。' },
  pipe: { nameJp: 'パイプ', description: '足場の骨組みを構成する鋼管です。' },
  brace: { nameJp: 'ブレス', description: 'X状の筋交い。水平方向の剛性を高め、足場の変形を防ぎます。' },
  tesuri: { nameJp: '手摺', description: '作業床の内側に設ける水平材。転落防止と作業性のため、高さ850mm以上が推奨されます。' },
  nuno: { nameJp: '布材（ヌノ）', description: '水平支持材。端部のストッパーや構造補強として使います。' },
  plank: { nameJp: '踏板（アンチ）', description: '作業員が乗る床板。500mm×スパン長が標準です。' },
  anchi: { nameJp: '踏板（アンチ）', description: '足場の作業床。幅500mmまたは240mmの半幅があります。' },
  habaki: { nameJp: '巾木（ハバキ）', description: '足場の先端に設ける幅木。転落防止のための toe board です。' },
  jack: { nameJp: 'ジャッキベース', description: '支柱の根元に設置し、高さを微調整する部材です。' },
  stair: { nameJp: '階段', description: 'レベル間の昇降用。手摺付きで安全に通行できます。' },
  frame: { nameJp: '建枠', description: '枠組足場の基本ユニット。門型フレームで一層の高さを構成します。' },
  endStopper: { nameJp: '端部', description: '壁面の両端に設置する端部材。布材タイプまたは枠タイプがあります。' },
};

export default function Scaffold3DView({
  result,
  totalLevels = 1,
  complianceMode = 'default',
  technicalQuotationMode = false,
}: Scaffold3DViewProps) {
  const { t } = useI18n();
  const params = useParams();
  const configId = params.configId as string;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [simplified, setSimplified] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [activeWallIdx, setActiveWallIdx] = useState<number>(0);
  const [selectedComponent, setSelectedComponent] = useState<{ nameJp: string; description: string } | null>(null);
  const [technicalMode, setTechnicalMode] = useState(technicalQuotationMode ?? false);
  // 4D construction animation
  const [animLevel, setAnimLevel] = useState<number>(-1); // -1 = show all
  const [animPlaying, setAnimPlaying] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Section cut
  const [sectionCutY, setSectionCutY] = useState<number>(-1); // -1 = disabled
  const clippingPlaneRef = useRef<any>(null);
  // Color coding
  const [colorCoding, setColorCoding] = useState(false);
  // Hover tooltip
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; name: string } | null>(null);
  // Scene info refs (set inside useEffect, read by UI)
  const maxLevelsRef = useRef(1);
  const maxHeightRef = useRef(5);
  const wallObjectsRef = useRef<Array<{ root: any; label: any; edge: any }>>([]);
  const wallFocusRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  const clickTargetsRef = useRef<any[]>([]);
  const componentMeshesRef = useRef<any[]>([]);
  const controlsRef = useRef<any>(null);

  const isAiBim = complianceMode === 'ai_bim';

  // Support both flat (result.walls) and nested (result.result.walls) API shapes
  const rawWalls: WallCalculationResult[] = Array.isArray(result?.walls)
    ? result.walls
    : Array.isArray((result as any)?.result?.walls)
      ? (result as any).result.walls
      : [];

  // Patch: when walls have different wallHeightMm but identical fullLevels,
  // recalculate per-wall levels so the scaffold follows the stepped building profile.
  const walls: WallCalculationResult[] = (() => {
    if (rawWalls.length < 2) return rawWalls;
    const heights = rawWalls.map((w) => w.wallHeightMm).filter((h): h is number => typeof h === 'number' && h >= 1000);
    const uniqueHeights = new Set(heights.map((h) => Math.round(h / 100)));
    if (uniqueHeights.size <= 1) return rawWalls;
    const levels = rawWalls.map((w) => w.levelCalc?.fullLevels ?? 0);
    const uniqueLevels = new Set(levels);
    if (uniqueLevels.size > 1) return rawWalls;
    const scaffoldType: 'kusabi' | 'wakugumi' =
      (result?.scaffoldType ?? (result as any)?.scaffold_type ?? 'kusabi') as any;
    const levelH = scaffoldType === 'wakugumi' ? (result?.frameSizeMm || 1700) : 1800;
    return rawWalls.map((w) => {
      const wh = w.wallHeightMm;
      if (typeof wh !== 'number' || !Number.isFinite(wh) || wh < 1000) return w;
      const newLevels = Math.max(1, Math.ceil(wh / levelH));
      if (newLevels === w.levelCalc?.fullLevels) return w;
      return {
        ...w,
        levelCalc: {
          ...w.levelCalc,
          fullLevels: newLevels,
          topPlankHeightMm: newLevels * levelH,
          totalScaffoldHeightMm: newLevels * levelH + (w.levelCalc?.topGuardHeightMm ?? 900),
        },
      };
    });
  })();

  function setOpacityRecursive(obj: any, opacity: number) {
    obj.traverse((child: any) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m: any) => {
        m.transparent = opacity < 1;
        m.opacity = opacity;
        m.needsUpdate = true;
      });
    });
  }

  function applyWallVisibility(mode: ViewMode, focusedIdx: number) {
    const entries = wallObjectsRef.current;
    if (!entries.length) return;
    entries.forEach((entry, i) => {
      const selected = mode === 'all' || i === focusedIdx;
      const scaffoldOpacity = selected ? 1 : 0.18;
      const labelOpacity = selected ? 1 : 0.2;
      const edgeOpacity = selected ? 1 : 0.35;
      setOpacityRecursive(entry.root, scaffoldOpacity);
      if (entry.label?.material) {
        entry.label.material.opacity = labelOpacity;
        entry.label.material.needsUpdate = true;
      }
      if (entry.edge?.material) {
        entry.edge.material.opacity = edgeOpacity;
        entry.edge.material.transparent = edgeOpacity < 1;
        entry.edge.material.needsUpdate = true;
      }
    });
  }

  function focusCameraOnWall(index: number) {
    const controls = controlsRef.current;
    const focus = wallFocusRef.current[index];
    if (!controls || !focus) return;
    controls.target.set(focus.x, focus.y, focus.z);
    controls.spherical.radius = Math.max(5, Math.min(controls.maxRadius, controls.spherical.radius * 0.85));
  }

  useEffect(() => {
    if (!canvasContainerRef.current || !wrapperRef.current) return;
    if (walls.length === 0) {
      setError('No wall data. Run calculation for this configuration to see the 3D view.');
      return;
    }

    setReady(false);

    const canvasContainer = canvasContainerRef.current;
    let disposed = false;
    let renderer: any;
    let animId: number;
    let canvasElement: HTMLElement | null = null;

    import('three').then(async (THREE) => {
      if (disposed || !canvasContainerRef.current) return;

      const textures = await loadScaffoldTextures(THREE);
      if (disposed || !canvasContainerRef.current) return;

      while (canvasContainer.firstChild) {
        canvasContainer.removeChild(canvasContainer.firstChild);
      }

      const w = canvasContainer.clientWidth;
      const h = canvasContainer.clientHeight;

      // ── Scene (clean white BIM-style background, no fog) ──
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf0f0f0);
      sceneRef.current = scene;
      wallObjectsRef.current = [];
      wallFocusRef.current = [];
      clickTargetsRef.current = [];
      componentMeshesRef.current = [];

      // ── Camera ─────────────────────────────────────────
      const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 300);
      cameraRef.current = camera;

      // ── Renderer ───────────────────────────────────────
      renderer = new THREE.WebGLRenderer({ antialias: true });
      rendererRef.current = renderer;
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.localClippingEnabled = true;
      const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
      clippingPlaneRef.current = clipPlane;
      if ('outputColorSpace' in renderer) {
        (renderer as any).outputColorSpace = THREE.SRGBColorSpace;
      }
      canvasElement = renderer.domElement;
      canvasContainer.appendChild(canvasElement as unknown as Node);

      // ── Lights (clean BIM studio lighting — bright, even, good shadows) ─────────
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambientLight);

      const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 0.45);
      scene.add(hemiLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight.position.set(18, 25, 14);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.bias = -0.0002;
      scene.add(dirLight);

      const fillLight = new THREE.DirectionalLight(0xd0d8e0, 0.4);
      fillLight.position.set(-14, 10, -10);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xe8e8e8, 0.25);
      rimLight.position.set(-8, 18, 15);
      scene.add(rimLight);

      const isTech = technicalMode;

      // BIM-quality material properties: clean, smooth, no texture maps
      const metal = isTech ? 0.45 : 0.55;
      const rough = isTech ? 0.5 : 0.35;
      const plankMetal = isTech ? 0.45 : 0.05;
      const plankRough = isTech ? 0.5 : 0.65;

      // ── Shared materials (clean BIM style — no texture noise) ───
      const pipeMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.post : BIM_COLORS.pipe,
        metalness: metal, roughness: rough,
      });
      const pipeDarkMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.brace : BIM_COLORS.pipeDark,
        metalness: metal, roughness: rough + 0.05,
      });
      const plankMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.plank : BIM_COLORS.plank,
        metalness: plankMetal, roughness: plankRough,
      });

      const spanPlankMats: Record<number, THREE.MeshStandardMaterial> = {};
      const spanHabakiMats: Record<number, THREE.MeshStandardMaterial> = {};
      for (const span of STANDARD_SPANS) {
        const spanColor = isTech ? C_TECH.plank : BIM_COLORS.plank;
        spanPlankMats[span] = new THREE.MeshStandardMaterial({
          color: spanColor, metalness: plankMetal, roughness: plankRough,
        });
        spanHabakiMats[span] = new THREE.MeshStandardMaterial({
          color: isTech ? C_TECH.habaki : BIM_COLORS.habaki,
          metalness: plankMetal + 0.05, roughness: plankRough - 0.05,
        });
      }
      const getPlankMat = (spanMm: number): THREE.MeshStandardMaterial => {
        const closest = STANDARD_SPANS.reduce((a, b) =>
          Math.abs(a - spanMm) <= Math.abs(b - spanMm) ? a : b
        );
        return spanPlankMats[closest] ?? plankMat;
      };
      const getHabakiMat = (spanMm: number): THREE.MeshStandardMaterial => {
        const closest = STANDARD_SPANS.reduce((a, b) =>
          Math.abs(a - spanMm) <= Math.abs(b - spanMm) ? a : b
        );
        return spanHabakiMats[closest] ?? habakiMat;
      };

      const jackMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.jack : BIM_COLORS.jack,
        metalness: metal, roughness: rough + 0.1,
      });
      const habakiMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.habaki : BIM_COLORS.habaki,
        metalness: plankMetal, roughness: plankRough,
      });
      const stairMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.stair : BIM_COLORS.stair,
        metalness: metal, roughness: rough,
      });
      const groundMat = new THREE.MeshStandardMaterial({
        color: BIM_COLORS.ground, metalness: 0, roughness: 0.88,
      });
      const ecoPalletMat = new THREE.MeshStandardMaterial({
        color: BIM_COLORS.ecoPallet, metalness: 0.15, roughness: 0.75,
      });

      const postMat = pipeMat;
      const jackMatEff = jackMat;
      const plankMatEff = plankMat;

      const tesuriMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.tesuri : BIM_COLORS.tesuri,
        metalness: metal, roughness: rough,
      });
      const yokojiMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.yokoji : BIM_COLORS.yokoji,
        metalness: isTech ? 0.45 : metal, roughness: isTech ? 0.5 : rough,
      });
      const topGuardMat = isTech
        ? new THREE.MeshStandardMaterial({ color: C_TECH.topGuard, metalness: metal, roughness: rough })
        : pipeMat;
      const shitasanMat = isTech
        ? new THREE.MeshStandardMaterial({ color: C_TECH.shitasan, metalness: metal, roughness: rough })
        : pipeMat;
      const braceMat = pipeDarkMat;
      const habakiMatEff = habakiMat;

      const couplerMat = new THREE.MeshStandardMaterial({
        color: isTech ? 0x555555 : BIM_COLORS.coupler,
        metalness: metal + 0.1, roughness: rough + 0.1,
      });
      const basePlateMat = new THREE.MeshStandardMaterial({
        color: BIM_COLORS.basePlate, metalness: 0.2, roughness: 0.6,
      });
      const bracketMat = new THREE.MeshStandardMaterial({
        color: C_BRACKET, metalness: metal, roughness: rough,
      });
      const endStopperMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.endStopper : 0x7c3aed,
        metalness: metal, roughness: rough,
      });
      const endStopperFrameMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.endStopper : 0x6d28d9,
        metalness: metal + 0.1, roughness: rough,
      });

      const topGuardM = result.topGuardHeightMm / 1000;
      const scaffoldType: 'kusabi' | 'wakugumi' =
        (result.scaffoldType ?? (result as any).scaffold_type ?? 'kusabi') as 'kusabi' | 'wakugumi';
      const isWakugumi = scaffoldType === 'wakugumi';
      const LEVEL_H = isWakugumi ? ((result.frameSizeMm || 1700) / 1000) : LEVEL_H_KUSABI;

      // ── Helper functions ───────────────────────────────
      function addPipe(
        parent: THREE.Object3D,
        sx: number, sy: number, sz: number,
        ex: number, ey: number, ez: number,
        mat = pipeMat, r = PIPE_R,
      ) {
        const s = new THREE.Vector3(sx, sy, sz);
        const e = new THREE.Vector3(ex, ey, ez);
        const len = s.distanceTo(e);
        if (len < 0.001) return;
        const mid = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5);
        const dir = new THREE.Vector3().subVectors(e, s).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const geo = new THREE.CylinderGeometry(r, r, len, PIPE_SEG);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(mid);
        mesh.quaternion.copy(q);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      }

      function addBox(
        parent: THREE.Object3D,
        px: number, py: number, pz: number,
        sx: number, sy: number, sz: number,
        mat: THREE.MeshStandardMaterial,
      ) {
        const geo = new THREE.BoxGeometry(sx, sy, sz);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, py, pz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      }

      // ── Text sprite (canvas-based 3D label) ─────────────
      function makeTextSprite(text: string, opts?: { size?: number; color?: string; bg?: string }) {
        const size = opts?.size ?? 48;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        ctx.font = `bold ${size}px Arial`;
        const tw = ctx.measureText(text).width;
        canvas.width = Math.ceil(tw + 16);
        canvas.height = Math.ceil(size * 1.4);
        if (opts?.bg) {
          ctx.fillStyle = opts.bg;
          ctx.roundRect(0, 0, canvas.width, canvas.height, 4);
          ctx.fill();
        }
        ctx.font = `bold ${size}px Arial`;
        ctx.fillStyle = opts?.color ?? '#374151';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(spriteMat);
        const aspect = canvas.width / canvas.height;
        const h = 0.35;
        sprite.scale.set(h * aspect, h, 1);
        return sprite;
      }

      const dimLineMat = new THREE.LineBasicMaterial({ color: 0x6b7280, depthTest: false });

      function addDimLine(parent: THREE.Object3D, p1: THREE.Vector3, p2: THREE.Vector3, label: string, tickSize = 0.12) {
        const pts = [p1, p2];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, dimLineMat);
        line.userData = { noClip: true };
        parent.add(line);

        const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
        const perp = new THREE.Vector3(0, 1, 0);
        if (Math.abs(dir.y) > 0.9) perp.set(1, 0, 0);
        const tick = new THREE.Vector3().crossVectors(dir, perp).normalize().multiplyScalar(tickSize);

        for (const p of [p1, p2]) {
          const t1 = p.clone().add(tick);
          const t2 = p.clone().sub(tick);
          const tGeo = new THREE.BufferGeometry().setFromPoints([t1, t2]);
          const tLine = new THREE.Line(tGeo, dimLineMat);
          tLine.userData = { noClip: true };
          parent.add(tLine);
        }

        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const sprite = makeTextSprite(label, { size: 40, color: '#374151', bg: 'rgba(255,255,255,0.85)' });
        sprite.position.copy(mid);
        sprite.userData = { noClip: true };
        parent.add(sprite);
      }

      // ══════════════════════════════════════════════════════
      // BUILD SCAFFOLD FOR ONE WALL (local coordinates: along X axis, depth along Z)
      // First span: 4 posts. Each next span: reuse 2 closest, add 2 new → N+1 positions, 2 posts per position.
      // ══════════════════════════════════════════════════════
      function buildWallScaffold(
        wall: WallCalculationResult,
        group: THREE.Group,
        maxSpans?: number,
        skipInnerAtStart?: boolean,
        skipInnerAtEnd?: boolean,
        dropLeadingCorner600?: boolean,
        flushDeckAtCornerEnd?: boolean,
      ): { runLenM: number; postX: number[]; widthM: number; spansMm: number[]; startPostIdx: number } {
        const widthM = (wall.scaffoldWidthMm ?? result.scaffoldWidthMm ?? 900) / 1000;
        const isBracket = wall.layoutMode === 'bracket';
        const baseSpans = Array.isArray(wall.spans) && wall.spans.length > 0
          ? wall.spans
          : [Math.max(600, Number(wall.wallLengthMm) || 600)];
        const trimmedSpans = (
          dropLeadingCorner600 &&
          baseSpans.length > 1 &&
          Math.abs(baseSpans[0] - 600) <= 1
        ) ? baseSpans.slice(1) : baseSpans;
        const allSpans: number[] = trimmedSpans.length > 0 ? trimmedSpans : baseSpans;
        const spans = maxSpans != null && maxSpans < allSpans.length
          ? allSpans.slice(0, maxSpans)
          : allSpans;
        // N+1 post positions: first span uses positions 0,1 (4 posts); each next span adds 1 position (2 new posts, reuse 2)
        const postX: number[] = [0];
        let acc = 0;
        for (const s of spans) { acc += s / 1000; postX.push(acc); }
        // When wall starts at a corner: first span overruns 300mm so 1800 plank can fill gap to last 600 span.
        const hasStartOverrun = !!dropLeadingCorner600 && !isBracket && postX.length > 1;
        if (hasStartOverrun) {
          for (let j = 0; j < postX.length; j++) postX[j] -= CORNER_OVERRUN_M;
        }
        // When reusing corner posts from previous wall, do not create a duplicate start post pair.
        // Still draw the first span (e.g. 1800) plank from the wall so the plank is never removed.
        const reuseStartFromPrevCorner = !!dropLeadingCorner600 && !isBracket && postX.length > 1;
        const startPostIdx = reuseStartFromPrevCorner ? 1 : 0;
        const startSpanIdx = 0;
        // IMPORTANT (corner alignment):
        // Do NOT force the last post to exactly wallLengthMm.
        // A small overrun (≈200–300mm) is allowed/preferred to keep corners tight for pattanko.
        const totalLen = postX.length > 1
          ? (postX[postX.length - 1] - postX[0])
          : Math.max(wall.wallLengthMm, 600) / 1000;
        const levels = wall.levelCalc.fullLevels;
        const levelsToBuild = levels;
        // Post height = total scaffold height. No extension above top plank (was 0.2m cap).
        const postCapAbovePlank = 0;
        const totalPostH = levelsToBuild * LEVEL_H + postCapAbovePlank;

        // Corner joint disabled: each wall is independent (no extra inner post, no tesuri split)
        const cornerInnerPostX = null as number | null;

        const kaidanSpanIndices = wall.kaidanSpanIndices || [];
        const widthMm = wall.scaffoldWidthMm ?? result?.scaffoldWidthMm ?? 900;
        const stairCount = wall.stairAccessCount || 0;
        const hasAnyStairs = kaidanSpanIndices.length > 0 || stairCount > 0;
        const needsExtendedBay = wall.needsExtendedBay ?? (widthMm <= 600 && hasAnyStairs);
        const anchiLayout = ANCHI_LAYOUT_BY_WIDTH[widthMm] ?? ANCHI_LAYOUT_BY_WIDTH[600];
        const habakiCountPerSpan = result?.habakiCountPerSpan ?? 2;

        // Door opening span indices (for skipping planks/braces/habaki at ground level)
        const doorSpanIndices = new Set<number>();
        const doorOpeningsRaw = wall.doorOpenings ?? (wall as any).door_openings;
        if (Array.isArray(doorOpeningsRaw) && doorOpeningsRaw.length > 0) {
          for (const door of doorOpeningsRaw) {
            const start = door.startSpanIndex ?? 0;
            const count = door.spanCount ?? 2;
            for (let di = 0; di < count; di++) doorSpanIndices.add(start + di);
          }
        }

        // ── Eco pallets (エコプレット) at each post position ─────
        const palletH = 0.04;
        const palletW = 0.25;
        const palletD = 0.25;
        for (let pi = 0; pi < postX.length; pi++) {
          if (pi < startPostIdx) continue;
          const px = postX[pi];
          const skipInnerPal = !isBracket && ((pi === 0 && skipInnerAtStart) || (pi === postX.length - 1 && skipInnerAtEnd));
          for (const pz of isBracket ? [0] : (skipInnerPal ? [widthM] : [0, widthM])) {
            addBox(group, px, GROUND_Y + palletH / 2, pz, palletW, palletH, palletD, ecoPalletMat);
          }
        }

        // ── Base plates + Jack bases ──────────────────────────
        for (let pi = 0; pi < postX.length; pi++) {
          if (pi < startPostIdx) continue;
          const px = postX[pi];
          const skipInner = !isBracket && ((pi === 0 && skipInnerAtStart) || (pi === postX.length - 1 && skipInnerAtEnd));
          for (const pz of isBracket ? [0] : (skipInner ? [widthM] : [0, widthM])) {
            addBasePlate(THREE, group, px, GROUND_Y, pz, basePlateMat);
            addPipe(group, px, GROUND_Y, pz, px, GROUND_Y + JACK_H, pz, jackMatEff, PIPE_R * 0.95);
          }
        }

        // ── Vertical posts: from top of jack to top of scaffold ─────
        const postBaseY = GROUND_Y + JACK_H;
        const postHeightFromGround = totalPostH;
        for (let pi = 0; pi < postX.length; pi++) {
          if (pi < startPostIdx) continue;
          const px = postX[pi];
          const skipInner = !isBracket && ((pi === 0 && skipInnerAtStart) || (pi === postX.length - 1 && skipInnerAtEnd));
          for (const pz of isBracket ? [0] : (skipInner ? [widthM] : [0, widthM])) {
            addRealisticPost(THREE, group, px, postBaseY, pz, postHeightFromGround, postMat);
          }
        }

        // Base yokoji (根がらみ) removed — no yokoji on ground base in 3D view.

        // ── Stair positions ────────────────────────────
        let uniqueStairPos: number[] = [];
        if (kaidanSpanIndices.length > 0) {
          uniqueStairPos = kaidanSpanIndices;
        } else if (stairCount === 1) {
          uniqueStairPos = [Math.floor(spans.length / 2)];
        } else if (stairCount > 1) {
          const totalPositionsNeeded = 2 * stairCount - 1;
          const startPos = Math.floor((spans.length - totalPositionsNeeded) / 2);
          for (let si = 0; si < stairCount; si++) {
            const sIdx = startPos + si * 2;
            const clamped = Math.max(0, Math.min(spans.length - 1, sIdx));
            if (!uniqueStairPos.includes(clamped)) uniqueStairPos.push(clamped);
          }
          uniqueStairPos.sort((a, b) => a - b);
        }

        // ── Per-level components: working levels above ground (y = ground + jack + level height), not building floor level ───────────────────────
        for (let lv = 1; lv <= levelsToBuild; lv++) {
          const y = GROUND_Y + JACK_H + lv * LEVEL_H;

          // Width yokoji (horizontal bars along scaffold depth) + coupler hints
          const yokojiOverhang = 0.06;
          for (let pi = 0; pi < postX.length; pi++) {
            if (pi < startPostIdx) continue;
            const px = postX[pi];
            const skipInner = !isBracket && ((pi === 0 && skipInnerAtStart) || (pi === postX.length - 1 && skipInnerAtEnd));
            if (skipInner) continue;
            if (isBracket) {
              addPipe(group, px, y, widthM, px, y, 0, bracketMat, PIPE_R * 0.8);
            } else {
              addPipe(group, px, y - 0.02, -yokojiOverhang, px, y - 0.02, widthM + yokojiOverhang, yokojiMat, PIPE_R * 1.1);
              addCoupler(THREE, group, px, y, 0, couplerMat);
              addCoupler(THREE, group, px, y, widthM, couplerMat);
            }
          }
          if (cornerInnerPostX != null && !isBracket) {
            addRealisticNunoBar(THREE, group, cornerInnerPostX, y, 0, totalLen, 0, yokojiMat);
          }

          for (let i = startSpanIdx; i < spans.length; i++) {
            const x1 = postX[i];
            const x2 = postX[i + 1];
            const spanM = spans[i] / 1000;
            const cornerStartTouch = reuseStartFromPrevCorner && i === 0;
            const cornerEndTouch = !!flushDeckAtCornerEnd && i === spans.length - 1;
            // 0-gap corner rule: corner-touching spans render full length (no -40mm inset).
            const spanDeckLen = (cornerStartTouch || cornerEndTouch)
              ? spanM
              : Math.max(0.05, spanM - 0.04);
            const midX = (x1 + x2) / 2;
            const isStairSpan = uniqueStairPos.includes(i);
            const isDoorSpan = doorSpanIndices.has(i) && lv === 1;

            // Braces (ブレス) — skip at ground level for door opening spans
            // Kusabi: OUTER face only (z=widthM for double_post, z=0 for bracket)
            // Wakugumi: BOTH faces (front z=0 + back z=widthM)
            if (!isDoorSpan) {
              const braceBottomY = GROUND_Y + JACK_H + (lv - 1) * LEVEL_H + 0.18;
              const braceTopY = y - 0.18;
              if (isWakugumi && !isBracket) {
                for (const bz of [0, widthM]) {
                  addPipe(group, x1, braceBottomY, bz, x2, braceTopY, bz, braceMat, PIPE_R * 0.75);
                  addPipe(group, x1, braceTopY, bz, x2, braceBottomY, bz, braceMat, PIPE_R * 0.75);
                }
              } else {
                const braceZ = isBracket ? 0 : widthM;
                addPipe(group, x1, braceBottomY, braceZ, x2, braceTopY, braceZ, braceMat, PIPE_R * 0.75);
                addPipe(group, x1, braceTopY, braceZ, x2, braceBottomY, braceZ, braceMat, PIPE_R * 0.75);
              }
            }

            // Horizontal bars — type-dependent:
            // Kusabi: 手摺 (tesuri) — 2 rails at 0.45m and 0.9m above platform, outer face (z=0)
            // Wakugumi: 下桟 (shitasan) — 1 bottom bar near platform, BOTH faces
            if (isWakugumi) {
              const shitasanY = GROUND_Y + JACK_H + (lv - 1) * LEVEL_H + 0.05;
              if (!isBracket) {
                for (const sz of [0, widthM]) {
                  addPipe(group, x1, shitasanY, sz, x2, shitasanY, sz, shitasanMat, PIPE_R * 0.6);
                }
              } else {
                addPipe(group, x1, shitasanY, 0, x2, shitasanY, 0, shitasanMat, PIPE_R * 0.6);
              }
            } else {
              const railTop = y + 0.9;
              const railMid = y + 0.45;
              addPipe(group, x1, railTop, 0, x2, railTop, 0, tesuriMat, PIPE_R * 0.65);
              addPipe(group, x1, railMid, 0, x2, railMid, 0, tesuriMat, PIPE_R * 0.6);
            }

            // Plank / Anchi — rule: show plank if not a stair span, OR 600mm extended bay (stair span still has plank)
            // Skip planks at ground level for door openings
            const spanMm = spans[i];
            const plankColorMat = getPlankMat(spanMm);
            const habakiColorMat = getHabakiMat(spanMm);
            const showPlankHere = (!isStairSpan || needsExtendedBay) && !isDoorSpan;
            if (showPlankHere) {
              // Draw individual anchi boards by width: 600→1 full (500mm), 900→1 full + 1 half (240mm), 1200→2 full (500mm each)
              let zFront = 0;
              for (let f = 0; f < anchiLayout.full; f++) {
                const depthM = anchiLayout.fullWidthMm / 1000;
                const midZ = zFront + depthM / 2;
                addRealisticPlank(THREE, group, midX, y + 0.015, midZ, spanDeckLen, depthM, plankColorMat);
                addRealisticHabaki(THREE, group, midX, y + 0.015, zFront + 0.02, spanDeckLen, habakiColorMat);
                addRealisticHabaki(THREE, group, midX, y + 0.015, zFront + depthM - 0.02, spanDeckLen, habakiColorMat);
                zFront += depthM;
              }
              if (anchiLayout.half > 0 && anchiLayout.halfWidthMm != null) {
                const halfDepthM = anchiLayout.halfWidthMm / 1000;
                const midZ = zFront + halfDepthM / 2;
                addRealisticPlank(THREE, group, midX, y + 0.015, midZ, spanDeckLen, halfDepthM, plankColorMat);
                addRealisticHabaki(THREE, group, midX, y + 0.015, zFront + 0.02, spanDeckLen, habakiColorMat);
                addRealisticHabaki(THREE, group, midX, y + 0.015, zFront + halfDepthM - 0.02, spanDeckLen, habakiColorMat);
              }
            }

            // Habaki / Toe boards at outer (z=0) and inner (z=widthM). Wakugumi: 1 or 2 per span from result.
            // Skip habaki at ground level for door openings
            if (!isDoorSpan) {
              const drawHabakiFront = true;
              const drawHabakiBack = isWakugumi ? habakiCountPerSpan >= 2 : true;
              if (drawHabakiFront) addRealisticHabaki(THREE, group, midX, y + 0.06, 0, spanDeckLen, habakiColorMat);
              if (drawHabakiBack) addRealisticHabaki(THREE, group, midX, y + 0.06, widthM, spanDeckLen, habakiColorMat);
            }
          }

          // Top guard posts + top rail (最上段)
          if (lv === levelsToBuild && topGuardM > 0) {
            for (const pz of isBracket ? [0] : [0, widthM]) {
              for (let pi = 0; pi < postX.length; pi++) {
                if (pi < startPostIdx) continue;
                const px = postX[pi];
                const skipInner = !isBracket && pz === 0 && ((pi === 0 && skipInnerAtStart) || (pi === postX.length - 1 && skipInnerAtEnd));
                if (skipInner) continue;
                addPipe(group, px, y, pz, px, y + topGuardM, pz, topGuardMat, PIPE_R * 0.7);
              }
              for (let i = startSpanIdx; i < spans.length; i++) {
                const x1 = postX[i];
                const x2 = postX[i + 1];
                addPipe(group, x1, y + topGuardM, pz, x2, y + topGuardM, pz, topGuardMat, PIPE_R * 0.65);
              }
            }
          }
        }

        // ── Stairs ─────────────────────────────────────
        const RAIL_H_ABOVE = 0.9;
        const NUM_STEPS = 8;
        const EXT_BAY_DEPTH = 0.9; // extended bay projects 900mm outward from scaffold outer face

        for (let lv = 1; lv <= levelsToBuild; lv++) {
          if (uniqueStairPos.length === 0) continue;
          for (const stairSpanIdx of uniqueStairPos) {
          if (stairSpanIdx < startSpanIdx || stairSpanIdx >= spans.length) continue;
          const sx1 = postX[stairSpanIdx];
          const sx2 = postX[stairSpanIdx + 1];

          const btmY = GROUND_Y + JACK_H + (lv - 1) * LEVEL_H + 0.04;
          const topYStair = GROUND_Y + JACK_H + lv * LEVEL_H + 0.04;
          const sStartX = sx1 + 0.06;
          const sEndX   = sx2 - 0.06;

          if (needsExtendedBay) {
            // 600mm extended bay: stair is placed OUTSIDE the scaffold depth (z < 0)
            // 3 extra posts (O, P, Q) per stair span per level at z = -EXT_BAY_DEPTH
            const extZ = -EXT_BAY_DEPTH;

            // Extended bay posts (3 posts: at sx1, midpoint, sx2)
            const sMidX = (sx1 + sx2) / 2;
            for (const epx of [sx1, sMidX, sx2]) {
              const postBaseY = GROUND_Y + JACK_H;
              addRealisticPost(THREE, group, epx, postBaseY, extZ, totalPostH, postMat);
              addBasePlate(THREE, group, epx, GROUND_Y, extZ, basePlateMat);
              addPipe(group, epx, GROUND_Y, extZ, epx, GROUND_Y + JACK_H, extZ, jackMatEff, PIPE_R * 0.95);
            }

            // Horizontal bars connecting extended posts to main scaffold at z=0
            const yokojiY = GROUND_Y + JACK_H + lv * LEVEL_H;
            for (const epx of [sx1, sx2]) {
              addPipe(group, epx, yokojiY - 0.02, extZ, epx, yokojiY - 0.02, 0, yokojiMat, PIPE_R * 1.1);
            }

            // Braces on the extended bay outer face
            addPipe(group, sx1, btmY, extZ, sx2, topYStair - 0.04, extZ, braceMat, PIPE_R * 0.75);
            addPipe(group, sx1, topYStair - 0.04, extZ, sx2, btmY, extZ, braceMat, PIPE_R * 0.75);

            // Stair stringers and treads in extended bay (from z=0 outward to z=extZ)
            const stairZfront = extZ + 0.05;
            const stairZback  = -0.05;
            const stairZcenter = (stairZfront + stairZback) / 2;
            addPipe(group, sStartX, btmY, stairZfront, sEndX, topYStair, stairZfront, stairMat, PIPE_R);
            addPipe(group, sStartX, btmY, stairZback,  sEndX, topYStair, stairZback,  stairMat, PIPE_R);
            for (let st = 1; st <= NUM_STEPS; st++) {
              const t = st / (NUM_STEPS + 1);
              const stepX = sStartX + (sEndX - sStartX) * t;
              const stepY = btmY + (topYStair - btmY) * t;
              addBox(group, stepX, stepY, stairZcenter, 0.04, 0.018, Math.abs(stairZback - stairZfront), stairMat);
            }
            // Handrails on extended bay stair
            for (const hz of [stairZfront - 0.03, stairZback + 0.03]) {
              addPipe(group, sStartX, btmY + RAIL_H_ABOVE, hz, sEndX, topYStair + RAIL_H_ABOVE, hz, pipeMat, PIPE_R * 0.7);
              addPipe(group, sStartX, btmY + RAIL_H_ABOVE * 0.5, hz, sEndX, topYStair + RAIL_H_ABOVE * 0.5, hz, pipeMat, PIPE_R * 0.6);
            }
          } else {
            // Normal stair (900/1200mm): stair inside the scaffold depth, replaces plank
            const stairZfront = 0.05;
            const stairZback  = widthM - 0.05;
            const stairZcenter = (stairZfront + stairZback) / 2;

            addPipe(group, sStartX, btmY, stairZfront, sEndX, topYStair, stairZfront, stairMat, PIPE_R);
            addPipe(group, sStartX, btmY, stairZback,  sEndX, topYStair, stairZback,  stairMat, PIPE_R);
            for (let st = 1; st <= NUM_STEPS; st++) {
              const t = st / (NUM_STEPS + 1);
              const stepX = sStartX + (sEndX - sStartX) * t;
              const stepY = btmY + (topYStair - btmY) * t;
              addBox(group, stepX, stepY, stairZcenter, 0.04, 0.018, stairZback - stairZfront, stairMat);
            }
            for (const hz of [stairZfront - 0.03, stairZback + 0.03]) {
              addPipe(group, sStartX, btmY + RAIL_H_ABOVE, hz, sEndX, topYStair + RAIL_H_ABOVE, hz, pipeMat, PIPE_R * 0.7);
              addPipe(group, sStartX, btmY + RAIL_H_ABOVE * 0.5, hz, sEndX, topYStair + RAIL_H_ABOVE * 0.5, hz, pipeMat, PIPE_R * 0.6);
            }
          }

          } // end for stairSpanIdx
        }

        // ── Hariwaku (梁枠 / beam frame) at door openings ──────
        if (doorOpeningsRaw && doorOpeningsRaw.length > 0) {
          const hariwakuColor = 0xef4444;
          const hariwakuMat = new THREE.MeshStandardMaterial({ color: hariwakuColor, metalness: 0.4, roughness: 0.5 });
          const groundLevelY = GROUND_Y + JACK_H + LEVEL_H;

          for (const door of doorOpeningsRaw) {
            const si = door.startSpanIndex ?? (door as any).start_span_index ?? 0;
            const spanCount = door.spanCount ?? (door as any).span_count ?? 2;
            if (si < 0 || si + spanCount > spans.length) continue;
            const x1 = postX[si] ?? 0;
            const x2 = postX[si + spanCount] ?? postX[postX.length - 1];
            const doorLen = x2 - x1;
            if (doorLen <= 0) continue;

            // Top chord (beam at level 1 top)
            addPipe(group, x1, groundLevelY - 0.02, 0, x2, groundLevelY - 0.02, 0, hariwakuMat, PIPE_R * 1.2);
            addPipe(group, x1, groundLevelY - 0.02, widthM, x2, groundLevelY - 0.02, widthM, hariwakuMat, PIPE_R * 1.2);

            // Bottom chord
            const bottomY = groundLevelY - 0.35;
            addPipe(group, x1, bottomY, 0, x2, bottomY, 0, hariwakuMat, PIPE_R * 0.9);
            addPipe(group, x1, bottomY, widthM, x2, bottomY, widthM, hariwakuMat, PIPE_R * 0.9);

            // Diagonal truss members (X pattern per span in the door opening)
            for (let di = 0; di < spanCount; di++) {
              const sx1 = postX[si + di] ?? x1;
              const sx2 = postX[si + di + 1] ?? x2;
              for (const tz of [0, widthM]) {
                addPipe(group, sx1, groundLevelY - 0.02, tz, sx2, bottomY, tz, hariwakuMat, PIPE_R * 0.7);
                addPipe(group, sx1, bottomY, tz, sx2, groundLevelY - 0.02, tz, hariwakuMat, PIPE_R * 0.7);
              }
            }

            // Vertical web members at intermediate posts
            for (let di = 1; di < spanCount; di++) {
              const px = postX[si + di] ?? x1;
              for (const tz of [0, widthM]) {
                addPipe(group, px, bottomY, tz, px, groundLevelY - 0.02, tz, hariwakuMat, PIPE_R * 0.7);
              }
            }
          }
        }

        // ── End Stoppers at wall ends ─────────────────────────
        // Wakugumi: 端部布材 / 妻側枠 (user-selectable). Kusabi: 端部手摺 (2 heights × 2 ends, matches BOM).
        const endStopperType: 'nuno' | 'frame' = result?.endStopperType || 'nuno';
        if (postX.length >= 2) {
          const endPositions = [postX[startPostIdx], postX[postX.length - 1]];
          if (isWakugumi) {
            for (const ex of endPositions) {
              for (let lv = 1; lv <= levelsToBuild; lv++) {
                const y = GROUND_Y + JACK_H + lv * LEVEL_H;
                if (endStopperType === 'nuno') {
                  const barY1 = y + 0.05;
                  const barY2 = y + 0.45;
                  addPipe(group, ex, barY1, 0, ex, barY1, widthM, endStopperMat, PIPE_R * 0.7);
                  addPipe(group, ex, barY2, 0, ex, barY2, widthM, endStopperMat, PIPE_R * 0.7);
                } else {
                  const frameBottom = GROUND_Y + JACK_H + (lv - 1) * LEVEL_H + 0.05;
                  const frameTop = y - 0.05;
                  addPipe(group, ex, frameBottom, 0, ex, frameTop, 0, endStopperFrameMat, PIPE_R * 0.8);
                  addPipe(group, ex, frameBottom, widthM, ex, frameTop, widthM, endStopperFrameMat, PIPE_R * 0.8);
                  addPipe(group, ex, frameTop, 0, ex, frameTop, widthM, endStopperFrameMat, PIPE_R * 0.7);
                  addPipe(group, ex, frameBottom, 0, ex, frameBottom, widthM, endStopperFrameMat, PIPE_R * 0.6);
                }
              }
            }
          } else if (!isBracket) {
            for (const ex of endPositions) {
              for (let lv = 1; lv <= levelsToBuild; lv++) {
                const y = GROUND_Y + JACK_H + lv * LEVEL_H;
                const railTop = y + 0.9;
                const railMid = y + 0.45;
                addPipe(group, ex, railTop, 0, ex, railTop, widthM, endStopperMat, PIPE_R * 0.65);
                addPipe(group, ex, railMid, 0, ex, railMid, widthM, endStopperMat, PIPE_R * 0.6);
              }
            }
          }
        }

        return { runLenM: totalLen, postX, widthM, spansMm: spans, startPostIdx };
      }

      // ══════════════════════════════════════════════════════
      // BUILD POLYGON VERTICES & POSITION WALLS
      // ══════════════════════════════════════════════════════

      // Partition walls into tier groups for stepped/setback buildings.
      // Each tier group gets its own footprint polygon.
      const tierGroups: Array<{ tierIndex: number; baseHeightMm: number; walls: WallCalculationResult[]; wallIndices: number[] }> = [];
      {
        const tierMap = new Map<number, { walls: WallCalculationResult[]; wallIndices: number[]; baseHeightMm: number }>();
        for (let wi = 0; wi < walls.length; wi++) {
          const w = walls[wi];
          const ti = (w as any).tierIndex ?? 0;
          const bh = (w as any).baseHeightMm ?? 0;
          if (!tierMap.has(ti)) tierMap.set(ti, { walls: [], wallIndices: [], baseHeightMm: bh });
          const entry = tierMap.get(ti)!;
          entry.walls.push(w);
          entry.wallIndices.push(wi);
        }
        for (const [ti, entry] of [...tierMap.entries()].sort((a, b) => a[0] - b[0])) {
          tierGroups.push({ tierIndex: ti, baseHeightMm: entry.baseHeightMm, walls: entry.walls, wallIndices: entry.wallIndices });
        }
      }
      const hasTiers = tierGroups.length > 1;

      const storedVerts: Array<{ xFrac: number; yFrac: number }> | undefined =
        result?.polygonVertices ?? (result as any)?.polygonVertices;

      // For tier-aware rendering: build a polygon per tier group.
      // Ground tier uses storedVerts if available. Upper tiers prefer `massingTiers` vertices
      // (same coordinate system as the plan) so setbacks stay on the correct side — centroid
      // alignment of length-only polygons caused fake “stairs” on flush façades.
      const massingTiersSorted: BuildingMassingTier[] = Array.isArray((result as any)?.massingTiers)
        ? ([...(result as any).massingTiers] as BuildingMassingTier[])
            .filter((t) => Array.isArray(t.vertices) && t.vertices.length >= 3)
            .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0) || a.topHeightMm - b.topHeightMm)
        : [];

      const tierPolygons: Array<{ verts: PointXZ[]; footprintFromMassing: boolean }> = [];

      {
        const tg0 = tierGroups[0];
        const sv0 = tg0.tierIndex === 0 ? storedVerts : undefined;
        let tverts = buildFootprintPolygonXZ(tg0.walls, sv0);
        let tok = tverts.length >= 2 && tverts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
        if (!tok && sv0 && sv0.length > 0) {
          tverts = buildFootprintPolygonXZ(tg0.walls, undefined);
          tok = tverts.length >= 2 && tverts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
        }
        tierPolygons.push({ verts: tok ? tverts : [], footprintFromMassing: false });
      }

      // Primary polygon = ground tier (or first valid tier)
      let verts = tierPolygons[0]?.verts ?? [];

      const rawBaseVertsForMassing: Array<{ x: number; z: number }> = Array.isArray(storedVerts)
        ? storedVerts.map((v) => ({
            x: (v as any).xFrac ?? (v as any).x ?? 0,
            z: (v as any).yFrac ?? (v as any).y ?? 0,
          }))
        : [];

      for (let gi = 1; gi < tierGroups.length; gi++) {
        const tg = tierGroups[gi];
        const nW = tg.walls.length;
        let footprintFromMassing = false;
        let tverts: PointXZ[] = [];

        const byBase = massingTiersSorted.find(
          (m) => Math.abs((m.baseHeightMm ?? 0) - (tg.baseHeightMm ?? 0)) <= 2,
        );
        const byIdx = massingTiersSorted[tg.tierIndex];
        const candidate =
          byBase && byBase.vertices.length === nW
            ? byBase
            : byIdx && byIdx.vertices.length === nW
              ? byIdx
              : undefined;

        if (candidate && verts.length >= 2) {
          const mapped = normaliseMassingTierVerticesToGroundFootprint(
            candidate.vertices,
            verts,
            rawBaseVertsForMassing,
          );
          if (mapped.length === nW && mapped.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z))) {
            tverts = mapped;
            footprintFromMassing = true;
          }
        }

        if (!footprintFromMassing) {
          tverts = buildFootprintPolygonXZ(tg.walls, undefined);
          const tok = tverts.length >= 2 && tverts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
          if (!tok) tverts = [];
        }

        tierPolygons.push({ verts: tverts, footprintFromMassing });
      }

      // (verts already set from tier 0)
      let vertsOk = verts.length >= 2 && verts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
      if (!vertsOk) {
        setError(
          walls.length === 0
            ? 'No wall data. Run calculation for this configuration to see the 3D view.'
            : '3D viewer error: wall geometry is invalid (missing/NaN lengths). Recalculate or edit wall lengths.',
        );
        return;
      }

      // ── Compute span caps to prevent browser freeze ───
      const { caps: spanCaps, simplified: isSimplified } = computeSpanCaps(walls, LEVEL_H);
      setSimplified(isSimplified);

      // Center the polygon
      const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
      const cz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
      const signedAreaXZ = (pts: Array<{ x: number; z: number }>): number => {
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
        }
        return area / 2;
      };

      let maxH = 0;
      let maxExtent = 0;

      // Keep rendered wall geometry metadata so corner connectors can snap to real posts.
      const wallRenderInfos: Array<{
        root: any;
        postX: number[];
        widthM: number;
        spansMm: number[];
        startPostIdx: number;
      }> = [];

      // Offset from building wall to inner posts is always 300mm
      const standoffMm = WALL_TO_INNER_POSTS_MM;
      const standoffM = standoffMm / 1000;

      // Pre-compute per-tier polygon data (normal signs, offset paths, corner flags)
      const tierPolyData: Array<{
        tierVerts: PointXZ[];
        isOpen: boolean;
        normalSign: number;
        nearRow: PointXZ[];
        hasCornerAtStart: boolean[];
        hasCornerAtEnd: boolean[];
        isLShapedAtStart: boolean[];
        isLShapedAtEnd: boolean[];
      }> = [];
      const COS_L_SHAPED_MAX = 0.35;
      const COS_STRAIGHT_MIN = 0.98;

      for (let tgi = 0; tgi < tierGroups.length; tgi++) {
        const tg = tierGroups[tgi];
        const tv = tierPolygons[tgi]?.verts ?? verts;
        const tWalls = tg.walls;
        const tOpen = tWalls.length < tv.length;
        const tSign = !tOpen && tv.length >= 3
          ? (signedAreaXZ(tv) > 0 ? -1 : 1)
          : 1;
        const tNear = buildOffsetPathXZ(tv, tWalls.length, tSign, standoffM, tOpen);

        const hCS: boolean[] = [], hCE: boolean[] = [], iLS: boolean[] = [], iLE: boolean[] = [];
        for (let wi = 0; wi < tWalls.length; wi++) { hCS.push(false); hCE.push(false); iLS.push(false); iLE.push(false); }
        if (tWalls.length >= 2 && tv.length >= 3) {
          const nV = tv.length, nW = tWalls.length;
          const vIdxs = !tOpen ? Array.from({ length: nV }, (_, j) => j) : [1];
          for (const j of vIdxs) {
            const prev = (j - 1 + nV) % nV, next = (j + 1) % nV;
            const dxP = tv[j].x - tv[prev].x, dzP = tv[j].z - tv[prev].z;
            const dxN = tv[next].x - tv[j].x, dzN = tv[next].z - tv[j].z;
            const lP = Math.hypot(dxP, dzP), lN = Math.hypot(dxN, dzN);
            if (lP < 1e-6 || lN < 1e-6) continue;
            const cosA = (dxP * dxN + dzP * dzN) / (lP * lN);
            const absC = Math.abs(cosA);
            const isCor = absC < COS_STRAIGHT_MIN, isL = isCor && absC < COS_L_SHAPED_MAX;
            const wEnd = !tOpen ? (j - 1 + nW) % nW : j - 1;
            const wStart = !tOpen ? j % nW : j;
            if (wEnd >= 0 && wEnd < nW) { hCE[wEnd] = isCor; iLE[wEnd] = isL; }
            if (wStart >= 0 && wStart < nW) { hCS[wStart] = isCor; iLS[wStart] = isL; }
          }
        }
        tierPolyData.push({
          tierVerts: tv, isOpen: tOpen, normalSign: tSign, nearRow: tNear,
          hasCornerAtStart: hCS, hasCornerAtEnd: hCE, isLShapedAtStart: iLS, isLShapedAtEnd: iLE,
        });
      }

      // Legacy aliases for ground-tier polygon (used by building rendering below)
      const isOpenPolygon = tierPolyData[0]?.isOpen ?? (walls.length < verts.length);
      const outwardNormalSign = tierPolyData[0]?.normalSign ?? 1;
      const nearRowPath = tierPolyData[0]?.nearRow ?? [];
      const hasCornerAtStart = tierPolyData[0]?.hasCornerAtStart ?? [];
      const hasCornerAtEnd = tierPolyData[0]?.hasCornerAtEnd ?? [];
      const isLShapedAtStart = tierPolyData[0]?.isLShapedAtStart ?? [];
      const isLShapedAtEnd = tierPolyData[0]?.isLShapedAtEnd ?? [];

      // Render scaffold for each wall, using the correct tier polygon
      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const wallWidthM = (wall.scaffoldWidthMm ?? result?.scaffoldWidthMm ?? 900) / 1000;

        // Find which tier group this wall belongs to
        let tgi = 0;
        let localIdx = i;
        for (let g = 0; g < tierGroups.length; g++) {
          const gIdx = tierGroups[g].wallIndices.indexOf(i);
          if (gIdx >= 0) { tgi = g; localIdx = gIdx; break; }
        }
        const tpd = tierPolyData[tgi];
        const tierV = tpd?.tierVerts ?? verts;
        const footprintFromMassing = tierPolygons[tgi]?.footprintFromMassing ?? false;

        // Upper tiers from wall-length-only polygons start near origin; align their bbox
        // minimum to the ground footprint minimum so one straight back/side stays flush.
        // Massing-tier vertices are already in ground footprint space — no offset.
        let tierOffX = 0;
        let tierOffZ = 0;
        if (hasTiers && tgi > 0 && !footprintFromMassing && tierV.length >= 1) {
          const minGx = Math.min(...verts.map((v) => v.x));
          const minGz = Math.min(...verts.map((v) => v.z));
          const minTx = Math.min(...tierV.map((v) => v.x));
          const minTz = Math.min(...tierV.map((v) => v.z));
          tierOffX = minGx - minTx;
          tierOffZ = minGz - minTz;
        }

        const v1 = { x: tierV[localIdx].x + tierOffX, z: tierV[localIdx].z + tierOffZ };
        const v2Idx = tpd?.isOpen ? localIdx + 1 : ((localIdx + 1) % tierV.length);
        const v2 = { x: tierV[v2Idx].x + tierOffX, z: tierV[v2Idx].z + tierOffZ };

        // Edge direction on XZ plane
        const dx = v2.x - v1.x;
        const dz = v2.z - v1.z;
        const edgeLen = Math.hypot(dx, dz);
        if (edgeLen < 0.001) continue;

        // Use tier-specific polygon data for normals and corners
        const tierIsOpen = tpd?.isOpen ?? isOpenPolygon;
        const tierNormSign = tpd?.normalSign ?? outwardNormalSign;
        const tierNearRow = tpd?.nearRow ?? nearRowPath;

        // Outward normal from polygon winding.
        let nx = tierNormSign * (-dz / edgeLen);
        let nz = tierNormSign * (dx / edgeLen);
        if (tierIsOpen) {
          const midX = (v1.x + v2.x) / 2;
          const midZ = (v1.z + v2.z) / 2;
          const toCenterX = cx - midX;
          const toCenterZ = cz - midZ;
          if (nx * toCenterX + nz * toCenterZ > 0) {
            nx = -nx;
            nz = -nz;
          }
        }
        const fallbackStart = { x: v1.x + nx * standoffM, z: v1.z + nz * standoffM };
        const fallbackEnd = { x: v2.x + nx * standoffM, z: v2.z + nz * standoffM };
        const tierNearStart = tierNearRow[localIdx];
        const tierNearEndIdx = tierIsOpen ? localIdx + 1 : ((localIdx + 1) % tierNearRow.length);
        const tierNearEnd = tierNearRow[tierNearEndIdx];
        const nearStart = tierNearStart
          ? { x: tierNearStart.x + tierOffX, z: tierNearStart.z + tierOffZ }
          : fallbackStart;
        const nearEnd = tierNearEnd
          ? { x: tierNearEnd.x + tierOffX, z: tierNearEnd.z + tierOffZ }
          : fallbackEnd;
        const nearDx = nearEnd.x - nearStart.x;
        const nearDz = nearEnd.z - nearStart.z;
        const alignedLen = Math.hypot(nearDx, nearDz);
        if (alignedLen < 1e-6) continue;

        // Tier-specific corner flags
        const tHCS = tpd?.hasCornerAtStart ?? hasCornerAtStart;
        const tHCE = tpd?.hasCornerAtEnd ?? hasCornerAtEnd;
        const tILS = tpd?.isLShapedAtStart ?? isLShapedAtStart;
        const tILE = tpd?.isLShapedAtEnd ?? isLShapedAtEnd;
        const isStartCorner = (!tierIsOpen || localIdx > 0) && (tHCS[localIdx] ?? false);
        const isEndCorner = (!tierIsOpen || localIdx < tierGroups[tgi].walls.length - 1) && (tHCE[localIdx] ?? false);
        const isStartLShaped = isStartCorner && (tILS[localIdx] ?? false);
        const isEndLShaped = isEndCorner && (tILE[localIdx] ?? false);

        const wallRoot = new THREE.Group();
        const group = new THREE.Group();
        wallRoot.add(group);
        // L-shaped only: trim leading 600 and flush deck at corner end; non-L uses pattanko.
        const { runLenM, postX, widthM, spansMm, startPostIdx } = buildWallScaffold(
          wall,
          group,
          spanCaps[i],
          false,
          false,
          isStartLShaped,
          isEndLShaped,
        );

        // Scale/place wall run. Per 足場コーナー詳細図 (L-shaped only):
        // wall end extends 300mm past corner, then one 600mm span (total +900mm).
        // Wall start at L-corner: first span overruns 300mm so 1800 can go beyond wall and fill gap.
        const tierWallCount = tierGroups[tgi]?.walls.length ?? walls.length;
        const useCornerExtension = tierWallCount >= 2 && !tierIsOpen && isEndLShaped;
        const useStartCornerExtension = tierWallCount >= 2 && !tierIsOpen && isStartLShaped;
        const cornerExtensionM = CORNER_OVERRUN_M + CORNER_TURN_SPAN_M;
        const baseLen = Math.max(runLenM, 1e-6);
        let desiredLen = alignedLen;
        if (useCornerExtension) desiredLen += cornerExtensionM;
        if (useStartCornerExtension) desiredLen += CORNER_OVERRUN_M;
        const rawScale = desiredLen / baseLen;
        const fitScale = Number.isFinite(rawScale) ? Math.max(0.25, Math.min(4, rawScale)) : 1;
        wallRoot.scale.set(fitScale, 1, 1);

        // The wall scaffold is built in local space:
        //   local X = along wall length (0 to totalLen)
        //   local Z = scaffold depth (0 = outer face, widthM = inner face)
        //   local Y = height (up)
        //
        // We need to transform so that:
        //   local X → edge direction
        //   local Z → outward normal direction
        //   local Y → world Y (up)
        //   origin → v1 (centered) + standoff from building so near posts are 250–500mm from wall

        const edgeDirX = nearDx / alignedLen;
        const edgeDirZ = nearDz / alignedLen;

        // Translation: place scaffold start on the mitered near-row path.
        const tx = nearStart.x - cx;
        const tz = nearStart.z - cz;

        // Tier-wall elevation: scaffold starts at baseHeightMm instead of ground
        const baseYM = ((wall as any).baseHeightMm ?? 0) / 1000;

        // Build a transformation matrix (Three.js Matrix4 uses column-major internally,
        // but .set() takes row-major arguments):
        // Row 0: local X → (edgeDirX, 0, edgeDirZ) maps to world XZ
        // Row 1: local Y → (0, 1, 0) stays up, offset by tier base height
        // Row 2: local Z → (nx, 0, nz) maps to outward normal
        const matrix = new THREE.Matrix4();
        matrix.set(
          edgeDirX, 0, nx, tx,
          0,        1, 0,  baseYM,
          edgeDirZ, 0, nz, tz,
          0,        0, 0,  1,
        );

        wallRoot.applyMatrix4(matrix);
        scene.add(wallRoot);
        wallRenderInfos[i] = { root: wallRoot, postX, widthM, spansMm, startPostIdx };

        // Track extents (including tier base height offset)
        const levels = wall.levelCalc.fullLevels;
        const levelsShown = levels;
        const totalH = baseYM + GROUND_Y + JACK_H + levelsShown * LEVEL_H + (levelsShown >= levels ? topGuardM : 0);
        if (totalH > maxH) maxH = totalH;

        const dist = Math.hypot(v1.x - cx, v1.z - cz);
        if (dist + wallWidthM > maxExtent) maxExtent = dist + wallWidthM;

        // Visible edge segment for click target hint (slightly above ground)
        const edgePts = [
          new THREE.Vector3(v1.x - cx, GROUND_Y + 0.14, v1.z - cz),
          new THREE.Vector3(v2.x - cx, GROUND_Y + 0.14, v2.z - cz),
        ];
        const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePts);
        const edgeMat = new THREE.LineBasicMaterial({
          color: WALL_COLORS_HEX[i % WALL_COLORS_HEX.length],
          transparent: true,
          opacity: 0.95,
        });
        const edgeLine = new THREE.Line(edgeGeo, edgeMat);
        scene.add(edgeLine);

        // Invisible hit area to allow clicking each wall segment. Use ~85% of edge length.
        const clickBoxLen = Math.max(edgeLen * 0.85, 0.3);
        const clickGeo = new THREE.BoxGeometry(clickBoxLen, Math.max(totalH, 2), Math.max(wallWidthM * 0.35, 0.35));
        const clickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
        const clickMesh = new THREE.Mesh(clickGeo, clickMat);
        clickMesh.position.set(
          (v1.x + v2.x) / 2 - cx + nx * (standoffM + wallWidthM * 0.5),
          Math.max(totalH, 2) / 2,
          (v1.z + v2.z) / 2 - cz + nz * (standoffM + wallWidthM * 0.5),
        );
        clickMesh.rotation.y = Math.atan2(dz, dx);
        (clickMesh as any).userData = { wallIndex: i };
        scene.add(clickMesh);

        // ── Dimension lines (span sizes + height) ──
        const dimGroup = new THREE.Group();
        const dimOffset = standoffM + wallWidthM + 0.4;
        const startX = v1.x - cx + nx * dimOffset;
        const startZ = v1.z - cz + nz * dimOffset;
        const endX = v2.x - cx + nx * dimOffset;
        const endZ = v2.z - cz + nz * dimOffset;
        const dimY = GROUND_Y - 0.15;

        // Span dimension lines along wall length
        const spans = spansMm ?? wall.spans ?? [];
        let accum = 0;
        const wallLenM = edgeLen;
        const totalSpanMm = spans.reduce((s: number, v: number) => s + v, 0) || 1;
        for (let si = 0; si < spans.length; si++) {
          const t1 = accum / totalSpanMm;
          accum += spans[si];
          const t2 = accum / totalSpanMm;
          const p1 = new THREE.Vector3(
            startX + (endX - startX) * t1, dimY,
            startZ + (endZ - startZ) * t1,
          );
          const p2 = new THREE.Vector3(
            startX + (endX - startX) * t2, dimY,
            startZ + (endZ - startZ) * t2,
          );
          addDimLine(dimGroup, p1, p2, `${spans[si]}`, 0.08);
        }

        // Total length line (below span lines)
        const totalDimY = dimY - 0.5;
        addDimLine(
          dimGroup,
          new THREE.Vector3(startX, totalDimY, startZ),
          new THREE.Vector3(endX, totalDimY, endZ),
          `${(wall.wallLengthMm ?? 0).toLocaleString()}mm`,
          0.1,
        );

        // Height line (vertical, at start of wall)
        const hx = v1.x - cx + nx * dimOffset;
        const hz = v1.z - cz + nz * dimOffset;
        addDimLine(
          dimGroup,
          new THREE.Vector3(hx, GROUND_Y, hz),
          new THREE.Vector3(hx, totalH, hz),
          `${Math.round(totalH * 1000).toLocaleString()}mm`,
          0.1,
        );
        scene.add(dimGroup);

        wallObjectsRef.current.push({
          root: wallRoot,
          label: null,
          edge: edgeLine,
        });
        wallFocusRef.current.push({
          x: (v1.x + v2.x) / 2 - cx + nx * (standoffM + wallWidthM * 1.1),
          y: Math.max(totalH * 0.45, 2.2),
          z: (v1.z + v2.z) / 2 - cz + nz * (standoffM + wallWidthM * 1.1),
        });
        clickTargetsRef.current.push(clickMesh);
      }
      maxHeightRef.current = maxH;

      // ── Corner connection (reference: 足場コーナー詳細図) ─
      // Rule:
      //   1) 300mm overrun from corner on wall A inner row
      //   2) then 600mm corner span on wall A inner row
      //   3) reuse those two inner posts and connect each directly into wall B
      // This creates the direct one-to-one bars the user requested.

      const cornerGroup = new THREE.Group();
      const maxLevelsForCorners = Math.max(...walls.map((w) => w.levelCalc?.fullLevels ?? 1), 1);
      maxLevelsRef.current = maxLevelsForCorners;
      const cornerPlankMat = plankMatEff.clone();
      cornerPlankMat.side = THREE.DoubleSide;
      const toWorldXZ = (root: any, x: number, z: number) => {
        const p = root.localToWorld(new THREE.Vector3(x, 0, z));
        return { x: p.x, z: p.z };
      };

      for (let wi = 0; wi < walls.length; wi++) {
        const nextWi = (wi + 1) % walls.length;
        if (isOpenPolygon && nextWi <= wi) continue;
        if (!(hasCornerAtEnd[wi] ?? false)) continue;

        const infoA = wallRenderInfos[wi];
        const infoB = wallRenderInfos[nextWi];
        if (!infoA || !infoB) continue;
        if (infoA.postX.length < 2 || infoB.postX.length < 2) continue;

        const isLShaped = isLShapedAtEnd[wi] ?? false;

        // Reuse the actual last two inner posts from wall A (matches rendered geometry exactly).
        const aLast = infoA.postX.length - 1;
        const r1 = toWorldXZ(infoA.root, infoA.postX[aLast - 1], 0);
        const r2 = toWorldXZ(infoA.root, infoA.postX[aLast], 0);

        // Connect into wall B's first rendered span endpoint.
        const bFirstIdx = Math.min(Math.max(infoB.startPostIdx, 1), infoB.postX.length - 1);
        let t1 = toWorldXZ(infoB.root, infoB.postX[bFirstIdx], 0);
        let t2 = toWorldXZ(infoB.root, infoB.postX[bFirstIdx], infoB.widthM);
        // Keep left/right pairing stable and avoid crossing connectors.
        const matchDirect =
          Math.hypot(r1.x - t1.x, r1.z - t1.z) + Math.hypot(r2.x - t2.x, r2.z - t2.z);
        const matchCross =
          Math.hypot(r1.x - t2.x, r1.z - t2.z) + Math.hypot(r2.x - t1.x, r2.z - t1.z);
        if (matchCross < matchDirect) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }

        for (let lv = 1; lv <= maxLevelsForCorners; lv++) {
          const y = GROUND_Y + JACK_H + lv * LEVEL_H;

          if (isLShaped) {
            // L-shaped (~90°) corner: full rule — one-to-one connectors, 600 span pair, walkable deck.
            addPipe(cornerGroup, r1.x, y, r1.z, t1.x, y, t1.z, yokojiMat, PIPE_R * 0.9);
            addPipe(cornerGroup, r2.x, y, r2.z, t2.x, y, t2.z, yokojiMat, PIPE_R * 0.9);
            addPipe(cornerGroup, r1.x, y, r1.z, r2.x, y, r2.z, yokojiMat, PIPE_R * 0.8);
            const firstSpanDeck = new THREE.Shape();
            firstSpanDeck.moveTo(r1.x, -r1.z);
            firstSpanDeck.lineTo(t1.x, -t1.z);
            firstSpanDeck.lineTo(t2.x, -t2.z);
            firstSpanDeck.lineTo(r2.x, -r2.z);
            firstSpanDeck.closePath();
            const deckGeo = new THREE.ExtrudeGeometry(firstSpanDeck, { depth: 0.025, bevelEnabled: false });
            const deckMesh = new THREE.Mesh(deckGeo, cornerPlankMat);
            deckMesh.rotation.x = -Math.PI / 2;
            deckMesh.position.y = y + 0.028;
            deckMesh.castShadow = true;
            deckMesh.receiveShadow = true;
            cornerGroup.add(deckMesh);
            const hY = y + 0.06;
            addPipe(cornerGroup, r1.x, hY, r1.z, r2.x, hY, r2.z, habakiMatEff, PIPE_R * 0.5);
          } else {
            // Non-L-shaped corner: use pattanko (2 small filler planks per level to close the gap).
            const midX = (r1.x + r2.x + t1.x + t2.x) / 4;
            const midZ = (r1.z + r2.z + t1.z + t2.z) / 4;
            const pattankoW = 0.25;
            const pattankoD = 0.5;
            addBox(cornerGroup, midX, y + 0.028, midZ, pattankoW, 0.025, pattankoD, cornerPlankMat);
            addBox(cornerGroup, midX, y + 0.028, midZ, pattankoD, 0.025, pattankoW, cornerPlankMat);
          }
        }
      }
      scene.add(cornerGroup);

      // ── Building outline at ground level ─────────────────
      const outlineMat = new THREE.LineBasicMaterial({
        color: isAiBim ? 0x0f0f0f : 0x7a8090,
        linewidth: 2,
      });
      const outlinePts = verts.map(v => new THREE.Vector3(v.x - cx, GROUND_Y + 0.01, v.z - cz));
      if (!isOpenPolygon) {
        outlinePts.push(outlinePts[0].clone());
      }
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outlineLine = new THREE.Line(outlineGeo, outlineMat);
      scene.add(outlineLine);

      // Building fill — procedural building with floor slabs, window grids, and edges
      if (!isOpenPolygon && verts.length >= 3) {
        // ExtrudeGeometry extrudes in local +Z; rotation.x = -PI/2 maps local Y → world -Z.
        // So Shape(X, Y) → World(X, -Z). We negate Z so the building aligns with
        // the scaffold which uses world Z directly.
        const shape = new THREE.Shape();
        shape.moveTo(verts[0].x - cx, -(verts[0].z - cz));
        for (let i = 1; i < verts.length; i++) {
          shape.lineTo(verts[i].x - cx, -(verts[i].z - cz));
        }
        shape.closePath();
        const floorH = 3.0;
        const centeredVerts = verts.map(v => ({ x: v.x - cx, z: v.z - cz }));
        const fallbackWallHeightM = Math.max(maxH * 0.85, 2);
        const wallHeightsAllM = walls.map((wall) => {
          const explicitMm = wall.wallHeightMm;
          if (typeof explicitMm === 'number' && Number.isFinite(explicitMm) && explicitMm >= 1000) {
            return explicitMm / 1000;
          }
          const topPlankMm = wall.levelCalc?.topPlankHeightMm;
          if (typeof topPlankMm === 'number' && Number.isFinite(topPlankMm) && topPlankMm >= 1000) {
            return topPlankMm / 1000;
          }
          return fallbackWallHeightM;
        });
        // For building rendering, use ground-tier walls only (matching centeredVerts count)
        const groundTierWalls = hasTiers
          ? walls.filter((w) => ((w as any).tierIndex ?? 0) === 0)
          : walls;
        const wallHeightsM = groundTierWalls.length === centeredVerts.length
          ? groundTierWalls.map((wall) => {
              const explicitMm = wall.wallHeightMm;
              if (typeof explicitMm === 'number' && Number.isFinite(explicitMm) && explicitMm >= 1000) {
                return explicitMm / 1000;
              }
              const topPlankMm = wall.levelCalc?.topPlankHeightMm;
              if (typeof topPlankMm === 'number' && Number.isFinite(topPlankMm) && topPlankMm >= 1000) {
                return topPlankMm / 1000;
              }
              return fallbackWallHeightM;
            })
          : wallHeightsAllM.slice(0, centeredVerts.length);
        const buildingH = Math.max(...wallHeightsAllM, fallbackWallHeightM);
        const hasSteppedWallHeights =
          wallHeightsM.length === centeredVerts.length &&
          new Set(wallHeightsM.map((h) => Math.round(h * 1000))).size > 1;
        const massingTiers = Array.isArray((result as any)?.massingTiers)
          ? ((result as any).massingTiers as Array<{
              vertices: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;
              topHeightMm: number;
              baseHeightMm?: number;
            }>)
          : [];
        const hasMassingTiers = massingTiers.length > 0;
        const rawBaseVerts = Array.isArray(storedVerts)
          ? storedVerts.map((v) => ({
              x: (v as any).xFrac ?? (v as any).x ?? 0,
              z: (v as any).yFrac ?? (v as any).y ?? 0,
            }))
          : [];
        const builtBaseMinX = Math.min(...verts.map((v) => v.x));
        const builtBaseMinZ = Math.min(...verts.map((v) => v.z));
        const builtBaseSpan = Math.max(
          Math.max(...verts.map((v) => v.x)) - builtBaseMinX,
          Math.max(...verts.map((v) => v.z)) - builtBaseMinZ,
          1e-6,
        );
        const rawBaseMinX = rawBaseVerts.length > 0 ? Math.min(...rawBaseVerts.map((v) => v.x)) : 0;
        const rawBaseMinZ = rawBaseVerts.length > 0 ? Math.min(...rawBaseVerts.map((v) => v.z)) : 0;
        const rawBaseSpan = rawBaseVerts.length > 0
          ? Math.max(
              Math.max(...rawBaseVerts.map((v) => v.x)) - rawBaseMinX,
              Math.max(...rawBaseVerts.map((v) => v.z)) - rawBaseMinZ,
              1e-6,
            )
          : 1;
        const normaliseTierVerts = (
          tierVerts: Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>,
        ) => {
          const rawTierVerts = tierVerts.map((v) => ({
            x: v.xFrac ?? v.x ?? 0,
            z: v.yFrac ?? v.y ?? 0,
          }));
          if (rawTierVerts.length < 3) return [];
          if (rawBaseVerts.length >= 3) {
            const scale = builtBaseSpan / rawBaseSpan;
            return rawTierVerts.map((v) => ({
              x: builtBaseMinX + (v.x - rawBaseMinX) * scale,
              z: builtBaseMinZ + (v.z - rawBaseMinZ) * scale,
            }));
          }
          const maxCoord = Math.max(...rawTierVerts.map((v) => Math.max(Math.abs(v.x), Math.abs(v.z))));
          if (maxCoord > 1000) {
            return rawTierVerts.map((v) => ({ x: v.x / 1000, z: v.z / 1000 }));
          }
          return rawTierVerts;
        };

        /** BIM AI path: flat “shaded with edges” CAD look (solid fills + black outlines, no hatching / no translucent wash). */
        const edgeLineMat = new THREE.LineBasicMaterial({ color: 0x0a0a0a });
        const addBlackEdges = (geo: THREE.ExtrudeGeometry, posY: number) => {
          const eg = new THREE.EdgesGeometry(geo);
          const lines = new THREE.LineSegments(eg, edgeLineMat);
          lines.rotation.x = -Math.PI / 2;
          lines.position.y = posY;
          lines.userData = { noClip: true };
          scene.add(lines);
        };
        const addSteppedWallPanels = (
          wallMat: any,
          lineColor: number,
          lineOpacity: number,
        ) => {
          const panelLineMat = new THREE.LineBasicMaterial({
            color: lineColor,
            transparent: lineOpacity < 1,
            opacity: lineOpacity,
          });
          for (let i = 0; i < centeredVerts.length; i++) {
            const next = (i + 1) % centeredVerts.length;
            const edgeHeight = wallHeightsM[i] ?? buildingH;
            if (!Number.isFinite(edgeHeight) || edgeHeight <= 0.1) continue;
            const vStart = centeredVerts[i];
            const vEnd = centeredVerts[next];
            const positions = new Float32Array([
              vStart.x, GROUND_Y + 0.02, vStart.z,
              vEnd.x, GROUND_Y + 0.02, vEnd.z,
              vEnd.x, GROUND_Y + 0.02 + edgeHeight, vEnd.z,
              vStart.x, GROUND_Y + 0.02, vStart.z,
              vEnd.x, GROUND_Y + 0.02 + edgeHeight, vEnd.z,
              vStart.x, GROUND_Y + 0.02 + edgeHeight, vStart.z,
            ]);
            const wallGeo = new THREE.BufferGeometry();
            wallGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            wallGeo.computeVertexNormals();
            const wallMesh = new THREE.Mesh(wallGeo, wallMat);
            wallMesh.userData = { noClip: true };
            scene.add(wallMesh);

            const wallEdgePts = [
              new THREE.Vector3(vStart.x, GROUND_Y + 0.02, vStart.z),
              new THREE.Vector3(vEnd.x, GROUND_Y + 0.02, vEnd.z),
              new THREE.Vector3(vEnd.x, GROUND_Y + 0.02 + edgeHeight, vEnd.z),
              new THREE.Vector3(vStart.x, GROUND_Y + 0.02 + edgeHeight, vStart.z),
              new THREE.Vector3(vStart.x, GROUND_Y + 0.02, vStart.z),
            ];
            const wallEdge = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(wallEdgePts),
              panelLineMat,
            );
            wallEdge.userData = { noClip: true };
            scene.add(wallEdge);

            const roofEdge = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(vStart.x, GROUND_Y + 0.02 + edgeHeight, vStart.z),
                new THREE.Vector3(vEnd.x, GROUND_Y + 0.02 + edgeHeight, vEnd.z),
              ]),
              panelLineMat,
            );
            roofEdge.userData = { noClip: true };
            scene.add(roofEdge);

            for (let floorY = floorH; floorY < edgeHeight; floorY += floorH) {
              const floorGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(vStart.x, GROUND_Y + 0.02 + floorY, vStart.z),
                new THREE.Vector3(vEnd.x, GROUND_Y + 0.02 + floorY, vEnd.z),
              ]);
              const floorLine = new THREE.Line(
                floorGeo,
                new THREE.LineBasicMaterial({
                  color: lineColor,
                  transparent: true,
                  opacity: Math.max(0.35, lineOpacity * 0.7),
                }),
              );
              floorLine.userData = { noClip: true };
              scene.add(floorLine);
            }
          }
        };
        const addMassingTiers = (
          tierMat: any,
          edgeColor: number,
          edgeOpacity: number,
        ) => {
          const tierLineMat = new THREE.LineBasicMaterial({
            color: edgeColor,
            transparent: edgeOpacity < 1,
            opacity: edgeOpacity,
          });
          const sortedTiers = [...massingTiers]
            .filter((tier) => Array.isArray(tier.vertices) && tier.vertices.length >= 3)
            .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0) || a.topHeightMm - b.topHeightMm);
          for (const tier of sortedTiers) {
            const tierVerts = normaliseTierVerts(tier.vertices);
            if (tierVerts.length < 3) continue;
            const shapeTier = new THREE.Shape();
            shapeTier.moveTo(tierVerts[0].x - cx, -(tierVerts[0].z - cz));
            for (let i = 1; i < tierVerts.length; i++) {
              shapeTier.lineTo(tierVerts[i].x - cx, -(tierVerts[i].z - cz));
            }
            shapeTier.closePath();
            const baseY = GROUND_Y + 0.02 + ((tier.baseHeightMm ?? 0) / 1000);
            const topY = GROUND_Y + 0.02 + (tier.topHeightMm / 1000);
            if (!(topY > baseY)) continue;
            const geo = new THREE.ExtrudeGeometry(shapeTier, { depth: topY - baseY, bevelEnabled: false });
            const mesh = new THREE.Mesh(geo, tierMat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = baseY;
            mesh.userData = { noClip: true };
            scene.add(mesh);

            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), tierLineMat);
            edges.rotation.x = -Math.PI / 2;
            edges.position.y = baseY;
            edges.userData = { noClip: true };
            scene.add(edges);

            for (let floorY = Math.ceil(baseY / floorH) * floorH; floorY < topY; floorY += floorH) {
              const floorPts = tierVerts.map((v) => new THREE.Vector3(v.x - cx, floorY, v.z - cz));
              floorPts.push(floorPts[0].clone());
              const floorLine = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(floorPts),
                new THREE.LineBasicMaterial({
                  color: edgeColor,
                  transparent: true,
                  opacity: Math.max(0.35, edgeOpacity * 0.7),
                }),
              );
              floorLine.userData = { noClip: true };
              scene.add(floorLine);
            }
          }
        };

        // ── Realistic building rendering with brick/concrete/roof materials ──
        {
          const fc = isAiBim
            ? ((result as any)?.bimFacadeColors as
                | { lowerHex?: string; upperHex?: string; roofHex?: string; windowHex?: string; sillHex?: string }
                | undefined)
            : undefined;

          // Procedural brick texture for walls
          const brickCanvas = (() => {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 256;
            const ctx = c.getContext('2d')!;
            const rows = 8, cols = 4, mw = 2;
            const bH = Math.floor(256 / rows), bW = Math.floor(256 / cols);
            ctx.fillStyle = '#8b6a4a';
            ctx.fillRect(0, 0, 256, 256);
            for (let r = 0; r < rows; r++) {
              const y = r * bH;
              const off = (r % 2) * (bW / 2);
              for (let col = -1; col <= cols; col++) {
                const x = col * bW + off;
                const rv = 140 + Math.floor(Math.random() * 50);
                const gv = 85 + Math.floor(Math.random() * 35);
                const bv = 55 + Math.floor(Math.random() * 25);
                ctx.fillStyle = `rgb(${rv},${gv},${bv})`;
                ctx.fillRect(x + mw, y + mw, bW - mw * 2, bH - mw * 2);
                ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
                ctx.fillRect(x + mw + 2, y + mw + 2, bW - mw * 2 - 4, bH - mw * 2 - 4);
              }
            }
            ctx.strokeStyle = '#a09080'; ctx.lineWidth = mw;
            for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * bH); ctx.lineTo(256, r * bH); ctx.stroke(); }
            for (let r = 0; r < rows; r++) {
              const y = r * bH, off = (r % 2) * (bW / 2);
              for (let col = 0; col <= cols + 1; col++) { const x = col * bW + off; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bH); ctx.stroke(); }
            }
            return c;
          })();
          const brickTex = new THREE.CanvasTexture(brickCanvas);
          brickTex.wrapS = THREE.RepeatWrapping; brickTex.wrapT = THREE.RepeatWrapping;
          brickTex.repeat.set(3, 3);

          // Roof tile texture
          const roofCanvas = (() => {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 256;
            const ctx = c.getContext('2d')!;
            ctx.fillStyle = '#2a2a30'; ctx.fillRect(0, 0, 256, 256);
            const tRows = 12, tCols = 8;
            const tH = 256 / tRows, tW = 256 / tCols;
            for (let r = 0; r < tRows; r++) {
              const y = r * tH, off = (r % 2) * (tW / 2);
              for (let col = -1; col <= tCols; col++) {
                const x = col * tW + off;
                const v = 38 + Math.floor(Math.random() * 18);
                ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
                ctx.fillRect(x + 1, y + 1, tW - 2, tH - 2);
                ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
                ctx.fillRect(x + 1, y + 1, tW - 2, 2);
              }
            }
            return c;
          })();
          const roofTex = new THREE.CanvasTexture(roofCanvas);
          roofTex.wrapS = THREE.RepeatWrapping; roofTex.wrapT = THREE.RepeatWrapping;
          roofTex.repeat.set(4, 4);

          const wallMatBrick = new THREE.MeshStandardMaterial({
            map: brickTex,
            color: fc ? bimHexToNumber(fc.lowerHex, 0xc4886a) : 0xc4886a,
            roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
          });
          const wallMatUpper = new THREE.MeshStandardMaterial({
            map: brickTex,
            color: fc ? bimHexToNumber(fc.upperHex, 0xb07848) : 0xb07848,
            roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide,
          });
          const roofMatReal = new THREE.MeshStandardMaterial({
            map: roofTex,
            color: fc ? bimHexToNumber(fc.roofHex, 0x2c2c34) : 0x2c2c34,
            roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide,
          });
          const slabMat = new THREE.MeshStandardMaterial({
            color: 0xd4ccc0, roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide,
          });

          if (hasMassingTiers) {
            addMassingTiers(wallMatBrick, 0x0a0a0a, 1);
          } else if (hasSteppedWallHeights) {
            addSteppedWallPanels(wallMatBrick, 0x0a0a0a, 1);
          } else {
            const lowerH = buildingH * 0.48;
            const upperH = buildingH * 0.52;
            const baseY = GROUND_Y + 0.02;

            const lowerGeo = new THREE.ExtrudeGeometry(shape, { depth: lowerH, bevelEnabled: false });
            const lowerMesh = new THREE.Mesh(lowerGeo, wallMatBrick);
            lowerMesh.rotation.x = -Math.PI / 2;
            lowerMesh.position.y = baseY;
            lowerMesh.castShadow = true; lowerMesh.receiveShadow = true;
            lowerMesh.userData = { noClip: true };
            scene.add(lowerMesh);
            addBlackEdges(lowerGeo, baseY);

            const upperGeo = new THREE.ExtrudeGeometry(shape, { depth: upperH, bevelEnabled: false });
            const upperMesh = new THREE.Mesh(upperGeo, wallMatUpper);
            upperMesh.rotation.x = -Math.PI / 2;
            upperMesh.position.y = baseY + lowerH;
            upperMesh.castShadow = true; upperMesh.receiveShadow = true;
            upperMesh.userData = { noClip: true };
            scene.add(upperMesh);
            addBlackEdges(upperGeo, baseY + lowerH);

            const roofTopY = baseY + lowerH + upperH;
            const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
            const roofMeshObj = new THREE.Mesh(roofGeo, roofMatReal);
            roofMeshObj.rotation.x = -Math.PI / 2;
            roofMeshObj.position.y = roofTopY;
            roofMeshObj.castShadow = true; roofMeshObj.receiveShadow = true;
            roofMeshObj.userData = { noClip: true };
            scene.add(roofMeshObj);
            addBlackEdges(roofGeo, roofTopY);

            // Floor slab lines
            for (let floorY = floorH; floorY < buildingH; floorY += floorH) {
              const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
              const slabObj = new THREE.Mesh(slabGeo, slabMat);
              slabObj.rotation.x = -Math.PI / 2;
              slabObj.position.y = baseY + floorY;
              slabObj.userData = { noClip: true };
              scene.add(slabObj);
            }
          }
        }

        if (!hasMassingTiers) {
          // Window pattern on each facade (glass panes + dark frames)
          const fcWin = isAiBim
            ? ((result as any)?.bimFacadeColors as { windowHex?: string; sillHex?: string } | undefined)
            : undefined;
          const windowMat = new THREE.MeshPhysicalMaterial({
            color: bimHexToNumber(fcWin?.windowHex, 0x88bbdd),
            roughness: 0.05, metalness: 0.1,
            transparent: true, opacity: 0.5,
            side: THREE.DoubleSide,
            envMapIntensity: 1.2,
          });
          const windowFrameMat = new THREE.MeshStandardMaterial({
            color: bimHexToNumber(fcWin?.sillHex, 0x2d3748),
            roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide,
          });
          const windowH = floorH * 0.45;
          const windowBottomOffset = floorH * 0.3;

          for (let ei = 0; ei < centeredVerts.length; ei++) {
            const v1 = centeredVerts[ei];
            const v2 = centeredVerts[(ei + 1) % centeredVerts.length];
            const edgeHeight = wallHeightsM[ei] ?? buildingH;
            const nFloors = Math.max(1, Math.floor(edgeHeight / floorH));
            const edgeDx = v2.x - v1.x;
            const edgeDz = v2.z - v1.z;
            const edgeLen = Math.hypot(edgeDx, edgeDz);
            if (edgeLen < 2) continue;

            const normalX = -edgeDz / edgeLen;
            const normalZ = edgeDx / edgeLen;
            const windowSpacing = Math.max(1.5, Math.min(3, edgeLen / Math.max(1, Math.round(edgeLen / 2.5))));
            const nWindows = Math.max(1, Math.floor((edgeLen - 1) / windowSpacing));
            const windowW = windowSpacing * 0.55;
            const startOffset = (edgeLen - (nWindows - 1) * windowSpacing) / 2;

            for (let fi = 0; fi < nFloors; fi++) {
              const floorBase = GROUND_Y + 0.03 + fi * floorH;
              const wBot = floorBase + windowBottomOffset;
              const wMid = wBot + windowH / 2;

              for (let wi = 0; wi < nWindows; wi++) {
                const t = (startOffset + wi * windowSpacing) / edgeLen;
                const wx = v1.x + edgeDx * t + normalX * 0.015;
                const wz = v1.z + edgeDz * t + normalZ * 0.015;
                const angle = Math.atan2(normalX, normalZ);

                // Glass pane
                const windowGeo = new THREE.PlaneGeometry(windowW, windowH);
                const windowMeshObj = new THREE.Mesh(windowGeo, windowMat);
                windowMeshObj.position.set(wx, wMid, wz);
                windowMeshObj.rotation.y = angle;
                windowMeshObj.userData = { noClip: true };
                scene.add(windowMeshObj);

                // Window frame (4 bars around glass)
                const frameThick = 0.04;
                const frameDepth = 0.03;
                const frameOffset = normalX * 0.005;
                const frameOffsetZ = normalZ * 0.005;

                // Top frame bar
                const topBar = new THREE.Mesh(
                  new THREE.BoxGeometry(windowW + frameThick, frameThick, frameDepth),
                  windowFrameMat,
                );
                topBar.position.set(wx + frameOffset, wBot + windowH, wz + frameOffsetZ);
                topBar.rotation.y = angle;
                topBar.userData = { noClip: true };
                scene.add(topBar);

                // Bottom sill (thicker)
                const sillBar = new THREE.Mesh(
                  new THREE.BoxGeometry(windowW + frameThick * 2, frameThick * 1.5, frameDepth * 1.5),
                  windowFrameMat,
                );
                sillBar.position.set(wx + frameOffset, wBot - frameThick * 0.5, wz + frameOffsetZ);
                sillBar.rotation.y = angle;
                sillBar.userData = { noClip: true };
                scene.add(sillBar);
              }
            }
          }
        }
      }

      // ── Ground plane (clean light grey slab, subtle grid) ──────
      const groundSize = Math.max(maxExtent * 4 + 20, 100);
      const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
      const groundPlane = new THREE.Mesh(groundGeo, groundMat);
      groundPlane.rotation.x = -Math.PI / 2;
      groundPlane.position.y = GROUND_Y - 0.03;
      groundPlane.receiveShadow = true;
      groundPlane.userData = { noClip: true, isGround: true };
      scene.add(groundPlane);
      const gridDivisions = Math.min(40, Math.max(10, Math.floor(groundSize / 5)));
      const gridHelper = new THREE.GridHelper(groundSize, gridDivisions, 0xc8c8c8, 0xd4d4d4);
      gridHelper.position.y = GROUND_Y - 0.02;
      (gridHelper.material as THREE.Material).opacity = 0.3;
      (gridHelper.material as THREE.Material).transparent = true;
      gridHelper.userData = { noClip: true, isGround: true };
      scene.add(gridHelper);

      // ── Camera: center on building, maintain true proportions (no stretch) ───────
      const extent = Math.max(maxExtent, 5);
      const dist = Math.max(extent * 2.5, maxH * 2.2, 12);
      const centerY = Math.max(maxH * 0.4, 2);
      camera.position.set(
        dist * 0.6,
        centerY + dist * 0.5,
        dist * 0.6,
      );
      camera.lookAt(0, centerY * 0.5, 0);
      camera.far = dist * 5;
      camera.updateProjectionMatrix();

      // ── Orbit Controls ───────────────────────────────
      const target = new THREE.Vector3(0, centerY * 0.5, 0);
      const camOffset = new THREE.Vector3().subVectors(camera.position, target);
      let spherical = new THREE.Spherical().setFromVector3(camOffset);
      let isDragging = false;
      let movedWhileDragging = false;
      let prevMX = 0, prevMY = 0;

      const canvas = renderer.domElement;
      canvasElement = canvas;
      canvas.style.cursor = 'grab';

      const onDown = (e: MouseEvent) => {
        isDragging = true;
        movedWhileDragging = false;
        prevMX = e.clientX;
        prevMY = e.clientY;
        canvas.style.cursor = 'grabbing';
      };
      const onMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - prevMX;
        const dy = e.clientY - prevMY;
        if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) movedWhileDragging = true;
        prevMX = e.clientX;
        prevMY = e.clientY;
        spherical.theta -= dx * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - dy * 0.005));
      };
      const onUp = () => {
        isDragging = false;
        canvas.style.cursor = 'grab';
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        spherical.radius = Math.max(3, Math.min(80, spherical.radius + e.deltaY * 0.03));
      };
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const onClick = (e: MouseEvent) => {
        if (movedWhileDragging) return;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(clickTargetsRef.current, false);
        if (!hits.length) {
          setSelectedComponent(null);
          return;
        }
        const wallIndex = hits[0].object?.userData?.wallIndex;
        if (!Number.isInteger(wallIndex)) return;
        setViewMode('wall');
        setActiveWallIdx(wallIndex);
        applyWallVisibility('wall', wallIndex);
        focusCameraOnWall(wallIndex);
        setSelectedComponent(COMPONENT_INFO['pipe'] ?? { nameJp: '足場構造', description: 'この壁面の足場です。支柱・ブレス・踏板・手摺などで構成されています。' });
      };

      canvas.addEventListener('mousedown', onDown);
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mouseup', onUp);
      canvas.addEventListener('mouseleave', onUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('click', onClick);

      // Touch support
      let touchStart = { x: 0, y: 0, dist: 0 };
      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          touchStart.x = e.touches[0].clientX;
          touchStart.y = e.touches[0].clientY;
          isDragging = true;
        } else if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          touchStart.dist = Math.sqrt(dx * dx + dy * dy);
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1 && isDragging) {
          const dx = e.touches[0].clientX - touchStart.x;
          const dy = e.touches[0].clientY - touchStart.y;
          touchStart.x = e.touches[0].clientX;
          touchStart.y = e.touches[0].clientY;
          spherical.theta -= dx * 0.005;
          spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - dy * 0.005));
        } else if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const delta = touchStart.dist - dist;
          spherical.radius = Math.max(3, Math.min(80, spherical.radius + delta * 0.05));
          touchStart.dist = dist;
        }
      };
      const onTouchEnd = () => { isDragging = false; };
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);

      // ── Resize ───────────────────────────────────────
      const onResize = () => {
        if (!canvasContainer) return;
        const nw = canvasContainer.clientWidth;
        const nh = canvasContainer.clientHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener('resize', onResize);
      controlsRef.current = {
        target,
        spherical,
        maxRadius: 80,
      };
      applyWallVisibility(viewMode, activeWallIdx);

      // ── Animation loop ───────────────────────────────
      function animate() {
        if (disposed) return;
        animId = requestAnimationFrame(animate);
        const pos = new THREE.Vector3().setFromSpherical(spherical).add(target);
        camera.position.copy(pos);
        camera.lookAt(target);
        renderer.render(scene, camera);
      }
      animate();
      setReady(true);

      // ── IFC Model Loading (when ifcFileUrl is available) ──
      // Renders the actual BIM model with element-type-aware materials
      // (brick walls, dark slate roofs, blue glass windows, concrete slabs)
      const ifcFileUrl = result?.ifcFileUrl;
      if (ifcFileUrl && typeof ifcFileUrl === 'string') {
        (async () => {
          try {
            const { parseIfcToMeshes } = await import('@/lib/ifc-loader');
            const { createBimMaterialSet, getMaterialForElement, disposeBimMaterials } = await import('@/lib/ifc-bim-materials');
            const response = await fetch(ifcFileUrl);
            if (!response.ok) return;
            const arrayBuffer = await response.arrayBuffer();
            const meshes = await parseIfcToMeshes(arrayBuffer);
            if (disposed || meshes.length === 0) return;

            const bimMaterials = createBimMaterialSet(THREE);
            const ifcGroup = new THREE.Group();
            ifcGroup.userData = { noClip: true, isIfcModel: true, bimMaterials };

            let ifcMinX = Infinity, ifcMaxX = -Infinity;
            let ifcMinY = Infinity, ifcMaxY = -Infinity;
            let ifcMinZ = Infinity, ifcMaxZ = -Infinity;

            for (const mesh of meshes) {
              const stride = 6;
              const count = mesh.vertices.length / stride;
              for (let vi = 0; vi < count; vi++) {
                const x = mesh.vertices[vi * stride];
                const y = mesh.vertices[vi * stride + 1];
                const z = mesh.vertices[vi * stride + 2];
                if (x < ifcMinX) ifcMinX = x; if (x > ifcMaxX) ifcMaxX = x;
                if (y < ifcMinY) ifcMinY = y; if (y > ifcMaxY) ifcMaxY = y;
                if (z < ifcMinZ) ifcMinZ = z; if (z > ifcMaxZ) ifcMaxZ = z;
              }
            }

            const ifcSizeX = ifcMaxX - ifcMinX;
            const ifcSizeY = ifcMaxY - ifcMinY;
            const ifcSizeZ = ifcMaxZ - ifcMinZ;
            const ifcCenterX = (ifcMinX + ifcMaxX) / 2;
            const ifcCenterZ = (ifcMinZ + ifcMaxZ) / 2;

            const buildingExtentX = Math.max(...verts.map(v => v.x - cx)) - Math.min(...verts.map(v => v.x - cx));
            const buildingExtentZ = Math.max(...verts.map(v => v.z - cz)) - Math.min(...verts.map(v => v.z - cz));
            const scaleX = ifcSizeX > 0.01 ? buildingExtentX / ifcSizeX : 1;
            const scaleZ = ifcSizeZ > 0.01 ? buildingExtentZ / ifcSizeZ : 1;
            const uniformScale = Math.min(scaleX, scaleZ);
            const scaleY = ifcSizeY > 0.01 ? maxH / ifcSizeY : uniformScale;

            for (const meshData of meshes) {
              if (meshData.elementType === 'opening') continue;

              const stride = 6;
              const vertCount = meshData.vertices.length / stride;
              const positions = new Float32Array(vertCount * 3);
              const normals = new Float32Array(vertCount * 3);

              for (let vi = 0; vi < vertCount; vi++) {
                positions[vi * 3]     = (meshData.vertices[vi * stride] - ifcCenterX) * uniformScale;
                positions[vi * 3 + 1] = (meshData.vertices[vi * stride + 1] - ifcMinY) * scaleY + GROUND_Y;
                positions[vi * 3 + 2] = (meshData.vertices[vi * stride + 2] - ifcCenterZ) * uniformScale;
                normals[vi * 3]     = meshData.vertices[vi * stride + 3];
                normals[vi * 3 + 1] = meshData.vertices[vi * stride + 4];
                normals[vi * 3 + 2] = meshData.vertices[vi * stride + 5];
              }

              const geo = new THREE.BufferGeometry();
              geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
              geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
              geo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

              const mat = getMaterialForElement(bimMaterials, meshData.elementType, meshData.expressID);

              const m = new THREE.Mesh(geo, mat as any);
              m.castShadow = meshData.elementType !== 'window' && meshData.elementType !== 'curtainWall';
              m.receiveShadow = true;
              m.userData = { noClip: true, ifcType: meshData.elementType };
              ifcGroup.add(m);
            }

            scene.add(ifcGroup);
          } catch (e) {
            console.warn('IFC model load failed (non-critical):', e);
          }
        })();
      }

      // ── Cleanup ──────────────────────────────────────
      return () => {
        disposed = true;
        if (animId) cancelAnimationFrame(animId);
        if (canvasElement) {
          canvasElement.removeEventListener('mousedown', onDown);
          canvasElement.removeEventListener('mousemove', onMove);
          canvasElement.removeEventListener('mouseup', onUp);
          canvasElement.removeEventListener('mouseleave', onUp);
          canvasElement.removeEventListener('wheel', onWheel);
          canvasElement.removeEventListener('click', onClick);
          canvasElement.removeEventListener('touchstart', onTouchStart);
          canvasElement.removeEventListener('touchmove', onTouchMove);
          canvasElement.removeEventListener('touchend', onTouchEnd);
        }
        window.removeEventListener('resize', onResize);
        if (renderer) renderer.dispose();
        if (canvasElement && canvasContainer && canvasContainer.contains(canvasElement)) {
          canvasContainer.removeChild(canvasElement);
        }
      };
    }).catch((err) => {
      console.error('Failed to load Three.js:', err);
      setError(err?.message || 'Failed to load 3D viewer');
    });

    return () => { disposed = true; };
  }, [
    walls,
    result?.scaffoldWidthMm,
    result?.topGuardHeightMm,
    result?.polygonVertices,
    result?.wallStandoffMm,
    isAiBim,
    technicalMode,
    t,
    JSON.stringify((result as any)?.massingTiers ?? null),
    JSON.stringify((result as any)?.bimFacadeColors ?? null),
  ]);

  useEffect(() => {
    applyWallVisibility(viewMode, activeWallIdx);
    if (viewMode === 'wall') focusCameraOnWall(activeWallIdx);
  }, [viewMode, activeWallIdx]);

  // ── Section cut: move clipping plane when slider changes ──
  useEffect(() => {
    const cp = clippingPlaneRef.current;
    if (!cp) return;
    const scene = sceneRef.current;
    if (!scene) return;
    if (sectionCutY < 0) {
      scene.traverse((obj: any) => {
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m: any) => { if (m.clippingPlanes) m.clippingPlanes = []; });
        }
      });
    } else {
      cp.constant = sectionCutY;
      scene.traverse((obj: any) => {
        if (obj.material && !obj.userData?.noClip) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m: any) => { m.clippingPlanes = [cp]; });
        }
      });
    }
  }, [sectionCutY]);

  // ── 4D animation: show/hide objects by level ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const LEVEL_H_VAL = 1.8;
    const JACK_H_VAL = 0.3;
    if (animLevel < 0) {
      scene.traverse((obj: any) => { obj.visible = true; });
      return;
    }
    const cutoffY = JACK_H_VAL + (animLevel + 1) * LEVEL_H_VAL;
    scene.traverse((obj: any) => {
      if (!obj.isMesh && !obj.isLine) return;
      if (obj.userData?.noClip || obj.userData?.isGround) return;
      const worldY = obj.getWorldPosition?.(obj.position.clone?.() ?? { x: 0, y: 0, z: 0 })?.y ?? obj.position?.y ?? 0;
      obj.visible = worldY <= cutoffY + 0.5;
    });
  }, [animLevel]);

  // ── 4D play timer ──
  useEffect(() => {
    if (!animPlaying) {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
      animTimerRef.current = null;
      return;
    }
    const max = maxLevelsRef.current;
    animTimerRef.current = setInterval(() => {
      setAnimLevel((prev) => {
        const next = prev + 1;
        if (next > max) {
          setAnimPlaying(false);
          return -1;
        }
        return next;
      });
    }, 800);
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, [animPlaying]);

  if (walls.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center" style={{ height: '650px' }}>
        <div className="text-center text-gray-500 p-8">
          <p className="font-medium mb-1">3D view</p>
          <p className="text-sm">No wall data. Run calculation for this configuration to see the 3D view.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center" style={{ height: '650px' }}>
        <div className="text-center text-gray-500">
          <p className="font-medium mb-1">3D viewer error</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // ─── Export helpers ────────────────────────────────────
  const triggerDownload = (data: Blob | string, filename: string) => {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleScreenshot = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    setExporting('png');
    try {
      const renderer = rendererRef.current;
      const canvas = renderer.domElement;
      const prevW = canvas.width;
      const prevH = canvas.height;
      const hiResW = Math.min(prevW * 2, 3840);
      const hiResH = Math.min(prevH * 2, 2160);

      renderer.setSize(hiResW, hiResH, false);
      renderer.render(sceneRef.current, cameraRef.current);

      const dataUrl = canvas.toDataURL('image/png');

      renderer.setSize(prevW, prevH, false);
      renderer.render(sceneRef.current, cameraRef.current);

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `scaffold_3d_${configId.slice(0, 8)}.png`;
      a.click();
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('Screenshot error:', error);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    if (!wrapperRef.current) return;
    setExporting('pdf');
    try {
      const canvas = await html2canvas(wrapperRef.current, { backgroundColor: '#f0f0f0', useCORS: true });
      const imageBase64 = canvas.toDataURL('image/png').split(',')[1];
      const blob = await scaffoldConfigsApi.export3DPdf(configId, imageBase64);
      triggerDownload(blob, `scaffold_3d_${configId.slice(0, 8)}.pdf`);
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('PDF export error:', error);
    } finally {
      setExporting(null);
    }
  };

  const handleExportGltf = async () => {
    if (!sceneRef.current) return;
    setExporting('gltf');
    try {
      const { GLTFExporter } = await import('three-stdlib');
      const exporter = new GLTFExporter();
      const scene = sceneRef.current;
      const savedFog = scene.fog;
      scene.fog = null;

      const gltfData: any = await new Promise((resolve, reject) => {
        exporter.parse(
          scene,
          (result: any) => resolve(result),
          (error: any) => reject(error),
          { binary: true },
        );
      });

      scene.fog = savedFog;
      const blob = new Blob([gltfData], { type: 'application/octet-stream' });
      triggerDownload(blob, `scaffold_3d_${configId.slice(0, 8)}.glb`);
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('glTF export error:', error);
    } finally {
      setExporting(null);
    }
  };

  const handleExportStl = async () => {
    if (!sceneRef.current) return;
    setExporting('stl');
    try {
      const { STLExporter } = await import('three-stdlib');
      const exporter = new STLExporter();
      const stlString = exporter.parse(sceneRef.current, { binary: false });
      triggerDownload(stlString, `scaffold_3d_${configId.slice(0, 8)}.stl`);
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('STL export error:', error);
    } finally {
      setExporting(null);
    }
  };

  const handleExportObj = async () => {
    setExporting('obj');
    try {
      const blob = await scaffoldConfigsApi.export3DCad(configId, walls[0].side);
      triggerDownload(blob, `scaffold_3d_${configId.slice(0, 8)}.obj`);
    } catch (error) {
      alert(t('result', 'exportFailed') || 'Export failed');
      console.error('OBJ export error:', error);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium text-gray-600">
              {t('result', 'view3dLabel')} — {walls.map(w => w.sideJp).join('・')} ({walls.length} walls)
            </div>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
              3D 足場ビュー
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{t('result', 'dragHint')} / Click wall segment to focus</span>
            <span className="text-gray-300">|</span>
            <span className="text-xs text-gray-500">Zoom:</span>
            <button
              type="button"
              onClick={() => {
                const c = controlsRef.current;
                if (c?.spherical) {
                  c.spherical.radius = Math.min(80, c.spherical.radius + 3);
                }
              }}
              className="p-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Zoom out"
              disabled={!ready}
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const c = controlsRef.current;
                if (c?.spherical) {
                  c.spherical.radius = Math.max(3, c.spherical.radius - 3);
                }
              }}
              className="p-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Zoom in"
              disabled={!ready}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-2 text-xs text-gray-600">
          <button
            onClick={() => setTechnicalMode((m) => !m)}
            className={`px-2.5 py-1 rounded border font-medium transition-colors ${
              technicalMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
            title={technicalMode ? '見積表示（部材色分け）' : '部材を色分けして表示'}
          >
            {technicalMode ? '見積表示 ON' : '見積表示'}
          </button>
          <span className="font-medium">Span (plank color):</span>
          {[600, 900, 1200, 1500, 1800].map((mm) => (
            <span key={mm} className="inline-flex items-center gap-1">
              <span
                className="w-3 h-3 rounded-full border border-gray-400"
                style={{ backgroundColor: '#' + (SPAN_COLORS[mm] ?? 0xfbbf24).toString(16).padStart(6, '0') }}
              />
              {mm}
            </span>
          ))}
          <span className="text-gray-400">|</span>
          <span>All levels shown</span>
          {walls.some((w) => w.layoutMode === 'bracket') && (
            <>
              <span className="text-gray-400">|</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#' + C_BRACKET.toString(16).padStart(6, '0') }} />
                ブラケット（柱回避）
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <button
            onClick={() => setViewMode('all')}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              viewMode === 'all'
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Overall Connected View
          </button>
          {walls.map((w, i) => (
            <button
              key={w.side}
              onClick={() => {
                setViewMode('wall');
                setActiveWallIdx(i);
              }}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                viewMode === 'wall' && activeWallIdx === i
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
              style={viewMode === 'wall' && activeWallIdx === i
                ? { backgroundColor: '#' + WALL_COLORS_HEX[i % WALL_COLORS_HEX.length].toString(16).padStart(6, '0') }
                : undefined}
            >
              {w.sideJp}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">
            <Download className="h-3.5 w-3.5 inline mr-0.5" />
            Export:
          </span>
          <button onClick={handleScreenshot} disabled={!!exporting || !ready}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-gray-700 hover:bg-gray-800 text-white transition-colors disabled:opacity-50"
            title="Screenshot — High-res PNG image">
            <Camera className="h-3.5 w-3.5" /> {exporting === 'png' ? '...' : 'PNG'}
          </button>
          <button onClick={handleExportPdf} disabled={!!exporting || !ready}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50">
            <FileText className="h-3.5 w-3.5" /> {exporting === 'pdf' ? '...' : 'PDF'}
          </button>
          <button onClick={handleExportGltf} disabled={!!exporting || !ready}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
            title="glTF Binary — Blender, SketchUp, BIM Viewers, AR/VR">
            <Box className="h-3.5 w-3.5" /> {exporting === 'gltf' ? '...' : 'glTF'}
          </button>
          <button onClick={handleExportStl} disabled={!!exporting || !ready}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50"
            title="STL — 3D Printing, FEM Analysis">
            <Box className="h-3.5 w-3.5" /> {exporting === 'stl' ? '...' : 'STL'}
          </button>
          <button onClick={handleExportObj} disabled={!!exporting || !ready}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            title="3D CAD export (OBJ). For 2D DXF use the 2D tab.">
            <FileCode className="h-3.5 w-3.5" /> {exporting === 'obj' ? '...' : 'OBJ'}
          </button>
        </div>

        {/* ── 4D Construction Animation + Section Cut + Color Coding ── */}
        {ready && (
          <div className="mt-2 pt-2 border-t border-gray-200 space-y-2">
            {/* 4D Animation */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">4D</span>
              <button
                onClick={() => {
                  if (animPlaying) { setAnimPlaying(false); return; }
                  setAnimLevel(0);
                  setAnimPlaying(true);
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  animPlaying ? 'bg-red-600 text-white border-red-600' : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {animPlaying ? '⏸ Pause' : '▶ Build'}
              </button>
              <input
                type="range" min={-1} max={maxLevelsRef.current}
                value={animLevel}
                onChange={(e) => { setAnimPlaying(false); setAnimLevel(Number(e.target.value)); }}
                className="flex-1 min-w-[120px] max-w-[300px] h-1.5 accent-indigo-600"
                title={animLevel < 0 ? 'All levels' : `Level ${animLevel}`}
              />
              <span className="text-xs text-gray-600 min-w-[60px]">
                {animLevel < 0 ? 'All' : `Lv ${animLevel}/${maxLevelsRef.current}`}
              </span>
              {animLevel >= 0 && (
                <button onClick={() => setAnimLevel(-1)} className="text-xs text-gray-500 hover:text-gray-700 underline">Reset</button>
              )}
            </div>

            {/* Section Cut */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">Section</span>
              <button
                onClick={() => setSectionCutY(sectionCutY < 0 ? maxHeightRef.current * 0.5 : -1)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  sectionCutY >= 0 ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {sectionCutY >= 0 ? '✂ Cut ON' : '✂ Cut'}
              </button>
              {sectionCutY >= 0 && (
                <>
                  <input
                    type="range" min={0.3} max={maxHeightRef.current + 1} step={0.1}
                    value={sectionCutY}
                    onChange={(e) => setSectionCutY(Number(e.target.value))}
                    className="flex-1 min-w-[120px] max-w-[300px] h-1.5 accent-amber-600"
                  />
                  <span className="text-xs text-gray-600 min-w-[50px]">{sectionCutY.toFixed(1)}m</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {simplified && ready && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            大規模足場のため、3D表示を簡略化しています（各壁の一部スパンのみ表示）。数量計算は全スパン分正確です。
          </span>
        </div>
      )}
      <div ref={wrapperRef} style={{ height: '650px', position: 'relative' }}>
        {selectedComponent && (
          <div className="absolute top-2 left-2 z-20 max-w-xs bg-white/95 border border-gray-200 rounded-lg shadow-lg p-3">
            <div className="flex items-center gap-2 text-indigo-700 font-medium mb-1">
              <Info className="h-4 w-4" />
              {selectedComponent.nameJp}
            </div>
            <p className="text-sm text-gray-600">{selectedComponent.description}</p>
            <button
              onClick={() => setSelectedComponent(null)}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700"
            >
              閉じる
            </button>
          </div>
        )}
        <div ref={canvasContainerRef} style={{ position: 'absolute', inset: 0 }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ background: '#f0f0f0', zIndex: 10 }}>
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-slate-500 mx-auto mb-2" />
              <p className="text-slate-600 text-sm">Loading 3D scaffold view...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
