'use client';

import { useRef, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, FileText, FileCode, Box, Download, Info, Plus, Minus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { WallCalculationResult, CalculatedComponent } from '@/lib/api/scaffold-configs';
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

/**
 * 3D Scaffold View — Closed Polygon
 * The building is one closed polygon; each edge is one wall. Walls are scaled to exactly
 * match the polygon edge length so corners meet with no gap (rectangle or any n-gon).
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

/**
 * Build polygon vertices from stored vertices or regular polygon fallback.
 * Returns 3D positions on XZ plane (in meters). Always NaN-safe.
 *
 * Rules:
 * - Uniform scale: X and Z use the SAME scale factor (no aspect distortion).
 * - 90° corners: For 4 walls (rectangle), use explicit rectangle with correct dimensions.
 * - Closed loop: Last vertex connects back to first; all n edges use wall lengths.
 * - Dimensions: Each edge length = walls[i].wallLengthMm (e.g. 11'-6" = 3505mm).
 */
function buildPolygonVertices(
  walls: WallCalculationResult[],
  storedVertices?: Array<{ xFrac: number; yFrac: number }>,
): { x: number; z: number }[] {
  const n = walls.length;
  if (n < 1) return [];

  // Normalise incoming vertices:
  // - DXF / vision-bim may send absolute mm coordinates: { x, y }
  // - Older AI output may send 0–1 fractions: { xFrac, yFrac }
  // We convert both into a unified { x, z } shape-space.
  const normaliseVertex = (v: any): { x: number; z: number } => {
    const hasMm = typeof v?.x === 'number' && typeof v?.y === 'number';
    if (hasMm) {
      // Keep mm as-is here; later logic decides whether to divide by 1000
      // or rescale uniformly based on spread/maxCoord.
      return {
        x: Number.isFinite(v.x) ? v.x : 0,
        z: Number.isFinite(v.y) ? v.y : 0,
      };
    }
    const xf = v?.xFrac;
    const yf = v?.yFrac;
    return {
      x: Number.isFinite(xf) ? xf : 0,
      z: Number.isFinite(yf) ? yf : 0,
    };
  };

  const wallLenM = (i: number) => {
    const mm = (walls[i] as any)?.wallLengthMm;
    const safeMm = Number.isFinite(mm) ? Math.max(600, Number(mm)) : 6000;
    return safeMm / 1000;
  };

  // ── 1 wall: single edge (2 vertices) ──
  if (n === 1) {
    const lenM = wallLenM(0);
    return [{ x: 0, z: 0 }, { x: lenM, z: 0 }];
  }

  // ── 2 walls: L-shape (3 vertices) ──
  if (n === 2) {
    const len0 = wallLenM(0);
    const len1 = wallLenM(1);
    return [{ x: 0, z: 0 }, { x: len0, z: 0 }, { x: len0, z: len1 }];
  }

  // ── 4 walls: try stored vertices first (preserves BIM AI non-rectangular shape);
  //    fall back to axis-aligned rectangle when stored vertices are absent or degenerate ──
  if (n === 4) {
    const rect = () => {
      const w0 = wallLenM(0);
      const w1 = wallLenM(1);
      return [
        { x: 0, z: 0 },
        { x: w0, z: 0 },
        { x: w0, z: w1 },
        { x: 0, z: w1 },
      ];
    };
    if (!storedVertices || storedVertices.length < 4) return rect();
    // Validate stored vertices form a non-degenerate polygon before using them
    const raw4 = storedVertices.slice(0, 4).map(normaliseVertex);
    const xs4 = raw4.map(v => v.x);
    const zs4 = raw4.map(v => v.z);
    const spread4 = Math.max(
      Math.max(...xs4) - Math.min(...xs4),
      Math.max(...zs4) - Math.min(...zs4),
    );
    // If all stored vertices are degenerate (zero spread / all same point),
    // or contain non-finite values, use the simple rectangle instead.
    if (spread4 < 0.001 || !raw4.every(v => Number.isFinite(v.x) && Number.isFinite(v.z))) {
      return rect();
    }
    // Non-degenerate stored vertices — fall through to generic handler below
  }

  // ── 6 walls: Irregular hexagon — rebuild from stored vertices + wall lengths, closed loop ──
  // Wall 6 end connects back to Wall 1 start (continuous perimeter, no gap).
  if (n === 6 && storedVertices && storedVertices.length >= 6) {
    const raw = storedVertices.slice(0, 6).map(normaliseVertex);
    const corrected: { x: number; z: number }[] = [{ x: 0, z: 0 }];
    for (let i = 0; i < 6; i++) {
      const next = (i + 1) % 6;
      const rawDx = raw[next].x - raw[i].x;
      const rawDz = raw[next].z - raw[i].z;
      const rawLen = Math.hypot(rawDx, rawDz);
      const tgtLen = wallLenM(i);
      const from = corrected[i];
      if (rawLen >= 0.001) {
        const dx = (rawDx / rawLen) * tgtLen;
        const dz = (rawDz / rawLen) * tgtLen;
        if (next > 0) {
          corrected.push({ x: from.x + dx, z: from.z + dz });
        } else {
          corrected[0] = { x: from.x + dx, z: from.z + dz };
        }
      }
    }
    return corrected;
  }

  // ── Use stored vertices (any wall count including 4 from BIM AI) ──
  if (storedVertices && storedVertices.length >= n) {
    const raw = storedVertices.slice(0, n).map(normaliseVertex);
    const xs = raw.map(v => v.x);
    const zs = raw.map(v => v.z);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadZ = Math.max(...zs) - Math.min(...zs);
    const spread = Math.max(spreadX, spreadZ, 1e-6);
    const maxCoord = Math.max(Math.max(...xs), Math.max(...zs));

    if (spread >= 1e-6) {
      let verts: { x: number; z: number }[];
      if (maxCoord <= 1.1 && spread <= 1.1) {
        // 0–1 fraction: UNIFORM scale (same factor for X and Z) to preserve aspect
        const refM = Math.max(...walls.map(w => Math.max(w.wallLengthMm, 600))) / 1000;
        const scale = refM / spread;
        verts = raw.map(v => ({ x: v.x * scale, z: v.z * scale }));
      } else if (spread > 1000 || maxCoord > 1000) {
        verts = raw.map(v => ({ x: v.x / 1000, z: v.z / 1000 }));
      } else {
        verts = raw.map(v => ({ x: v.x, z: v.z }));
      }

      const spreadM = Math.max(
        Math.max(...verts.map(v => v.x)) - Math.min(...verts.map(v => v.x)),
        Math.max(...verts.map(v => v.z)) - Math.min(...verts.map(v => v.z)),
      );
      if (spreadM > 0.01) {
        // Rebuild polygon: each edge i has length walls[i].wallLengthMm, direction from stored.
        // CLOSED LOOP: include the closing edge (n-1) -> 0.
        const corrected: { x: number; z: number }[] = [{ ...verts[0] }];
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          const rawDx = verts[next].x - verts[i].x;
          const rawDz = verts[next].z - verts[i].z;
          const rawLen = Math.hypot(rawDx, rawDz);
          const tgtLen = wallLenM(i);
          const from = corrected[i];
          if (rawLen < 0.001) {
            if (next > 0) corrected.push({ x: from.x, z: from.z });
            continue;
          }
          const dx = (rawDx / rawLen) * tgtLen;
          const dz = (rawDz / rawLen) * tgtLen;
          if (next > 0) {
            corrected.push({ x: from.x + dx, z: from.z + dz });
          } else {
            // Closing edge: ensure vertex 0 is reached (closed loop)
            corrected[0] = { x: from.x + dx, z: from.z + dz };
          }
        }
        return corrected;
      }
    }
  }

  // ── Generic fallback: place walls with lengths, force closed loop ──
  // Build n-1 edges from origin with equal angle steps; last edge closes back to (0,0).
  const extAngle = (2 * Math.PI) / n;
  const verts: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  let cx = 0, cz = 0;
  let angle = 0;
  for (let i = 0; i < n - 1; i++) {
    const lenM = wallLenM(i);
    cx += lenM * Math.cos(angle);
    cz += lenM * Math.sin(angle);
    angle += extAngle;
    verts.push({ x: cx, z: cz });
  }
  // Last edge: from verts[n-1] back to verts[0] with length walls[n-1] (closed loop)
  const lastLenM = wallLenM(n - 1);
  const dx = -cx;
  const dz = -cz;
  const dist = Math.hypot(dx, dz);
  if (dist >= 1e-6) {
    const scale = lastLenM / dist;
    verts[0] = { x: cx + dx * scale, z: cz + dz * scale };
  }
  return verts;
}

// ── Performance limits ──────────────────────────────────────
// Each span-level creates ~20 mesh objects.  Beyond this threshold
// we cap spans per wall so the browser stays responsive.
const MAX_TOTAL_MESHES = 60_000;           // ≈ 3 000 span-levels
const MESHES_PER_SPAN_LEVEL = 20;
const MAX_SPAN_LEVELS = Math.floor(MAX_TOTAL_MESHES / MESHES_PER_SPAN_LEVEL);

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
  const walls: WallCalculationResult[] = Array.isArray(result?.walls)
    ? result.walls
    : Array.isArray((result as any)?.result?.walls)
      ? (result as any).result.walls
      : [];

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
        color: isTech ? C_TECH.brace : BIM_COLORS.tesuri,
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

      const topGuardM = result.topGuardHeightMm / 1000;
      const scaffoldType: 'kusabi' | 'wakugumi' = result.scaffoldType || 'kusabi';
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
        const needsExtendedBay = wall.needsExtendedBay ?? (widthMm <= 600 && kaidanSpanIndices.length > 0);
        const anchiLayout = ANCHI_LAYOUT_BY_WIDTH[widthMm] ?? ANCHI_LAYOUT_BY_WIDTH[600];
        const isWakugumi = result?.scaffoldType === 'wakugumi';
        const habakiCountPerSpan = result?.habakiCountPerSpan ?? 2;

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
        const stairCount = wall.stairAccessCount || 0;
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

            // Braces (ブレス) — inner face (z=widthM) for double_post; outer face (z=0) for bracket
            const braceZ = isBracket ? 0 : widthM;
            const braceBottomY = GROUND_Y + JACK_H + (lv - 1) * LEVEL_H + 0.18;
            const braceTopY = y - 0.18;
            addPipe(group, x1, braceBottomY, braceZ, x2, braceTopY, braceZ, braceMat, PIPE_R * 0.75);
            addPipe(group, x1, braceTopY, braceZ, x2, braceBottomY, braceZ, braceMat, PIPE_R * 0.75);

            // Guard rails (手摺/布材) — outer face only (z=0), 2 rails per span per level.
            // Use fixed heights for consistency (0.90m and 0.45m above platform).
            const railTop = y + 0.9;
            const railMid = y + 0.45;
            addPipe(group, x1, railTop, 0, x2, railTop, 0, tesuriMat, PIPE_R * 0.65);
            addPipe(group, x1, railMid, 0, x2, railMid, 0, tesuriMat, PIPE_R * 0.6);

            // Plank / Anchi — rule: show plank if not a stair span, OR 600mm extended bay (stair span still has plank)
            const spanMm = spans[i];
            const plankColorMat = getPlankMat(spanMm);
            const habakiColorMat = getHabakiMat(spanMm);
            const showPlankHere = !isStairSpan || needsExtendedBay;
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
            const drawHabakiFront = true;
            const drawHabakiBack = isWakugumi ? habakiCountPerSpan >= 2 : true;
            if (drawHabakiFront) addRealisticHabaki(THREE, group, midX, y + 0.06, 0, spanDeckLen, habakiColorMat);
            if (drawHabakiBack) addRealisticHabaki(THREE, group, midX, y + 0.06, widthM, spanDeckLen, habakiColorMat);
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

        for (let lv = 1; lv <= levelsToBuild; lv++) {
          if (uniqueStairPos.length === 0) continue;
          for (const stairSpanIdx of uniqueStairPos) {
          if (stairSpanIdx < startSpanIdx || stairSpanIdx >= spans.length) continue;
          const sx1 = postX[stairSpanIdx];
          const sx2 = postX[stairSpanIdx + 1];

          const stairZfront = 0.05;
          const stairZback  = widthM - 0.05;
          const stairZcenter = (stairZfront + stairZback) / 2;

          const btmY = GROUND_Y + JACK_H + (lv - 1) * LEVEL_H + 0.04;
          const topYStair = GROUND_Y + JACK_H + lv * LEVEL_H + 0.04;
          const sStartX = sx1 + 0.06;
          const sEndX   = sx2 - 0.06;

          // Stringers
          addPipe(group, sStartX, btmY, stairZfront, sEndX, topYStair, stairZfront, stairMat, PIPE_R);
          addPipe(group, sStartX, btmY, stairZback,  sEndX, topYStair, stairZback,  stairMat, PIPE_R);

          // Step treads
          for (let st = 1; st <= NUM_STEPS; st++) {
            const t = st / (NUM_STEPS + 1);
            const stepX = sStartX + (sEndX - sStartX) * t;
            const stepY = btmY + (topYStair - btmY) * t;
            addBox(group, stepX, stepY, stairZcenter, 0.04, 0.018, stairZback - stairZfront, stairMat);
          }

          // Handrails (horizontal only; no extra vertical posts — only rule posts 2×(N+1) per wall)
          for (const hz of [stairZfront - 0.03, stairZback + 0.03]) {
            addPipe(group, sStartX, btmY + RAIL_H_ABOVE, hz, sEndX, topYStair + RAIL_H_ABOVE, hz, pipeMat, PIPE_R * 0.7);
            addPipe(group, sStartX, btmY + RAIL_H_ABOVE * 0.5, hz, sEndX, topYStair + RAIL_H_ABOVE * 0.5, hz, pipeMat, PIPE_R * 0.6);
          }
          } // end for stairSpanIdx
        }

        return { runLenM: totalLen, postX, widthM, spansMm: spans, startPostIdx };
      }

      // ══════════════════════════════════════════════════════
      // BUILD POLYGON VERTICES & POSITION WALLS
      // ══════════════════════════════════════════════════════
      const storedVerts: Array<{ xFrac: number; yFrac: number }> | undefined =
        result?.polygonVertices ?? (result as any)?.polygonVertices;
      let verts = buildPolygonVertices(walls, storedVerts);
      let vertsOk =
        verts.length >= 2 && verts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
      // Safety net: if stored vertices produced invalid geometry, retry without them
      if (!vertsOk && storedVerts && storedVerts.length > 0) {
        verts = buildPolygonVertices(walls, undefined);
        vertsOk =
          verts.length >= 2 && verts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
      }
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

      // Open polygon (L-shape): walls.length < verts.length; endpoints don't share corners
      const isOpenPolygon = walls.length < verts.length;

      // L-shaped corner: ~90° turn. Full corner rule (300+600, overrun, walkable deck) only for these.
      // Non-L-shaped corners use pattanko (small filler planks) instead.
      const COS_L_SHAPED_MAX = 0.35; // |cos| < 0.35 => angle between ~70° and ~110°
      const isLShapedAtStart: boolean[] = [];
      const isLShapedAtEnd: boolean[] = [];
      for (let i = 0; i < walls.length; i++) {
        isLShapedAtStart.push(false);
        isLShapedAtEnd.push(false);
      }
      if (walls.length >= 2 && verts.length >= 3) {
        // Closed polygon: every vertex j is a corner; use modulo for prev/next.
        // Open polygon (e.g. 2 walls, 3 verts): only vertex 1 is the corner between wall 0 and 1.
        const nV = verts.length;
        const nW = walls.length;
        const vertexIndices = !isOpenPolygon
          ? Array.from({ length: nV }, (_, j) => j)
          : [1];
        for (const j of vertexIndices) {
          const prev = (j - 1 + nV) % nV;
          const next = (j + 1) % nV;
          const dxPrev = verts[j].x - verts[prev].x;
          const dzPrev = verts[j].z - verts[prev].z;
          const dxNext = verts[next].x - verts[j].x;
          const dzNext = verts[next].z - verts[j].z;
          const lenPrev = Math.hypot(dxPrev, dzPrev);
          const lenNext = Math.hypot(dxNext, dzNext);
          if (lenPrev < 1e-6 || lenNext < 1e-6) continue;
          const cosAngle = (dxPrev * dxNext + dzPrev * dzNext) / (lenPrev * lenNext);
          const isL = Math.abs(cosAngle) < COS_L_SHAPED_MAX;
          const wallEnd = !isOpenPolygon ? (j - 1 + nW) % nW : j - 1;
          const wallStart = !isOpenPolygon ? j % nW : j;
          if (wallEnd >= 0 && wallEnd < nW) isLShapedAtEnd[wallEnd] = isL;
          if (wallStart >= 0 && wallStart < nW) isLShapedAtStart[wallStart] = isL;
        }
      }

      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const wallWidthM = (wall.scaffoldWidthMm ?? result?.scaffoldWidthMm ?? 900) / 1000;
        const v1 = verts[i];
        const v2 = verts[(i + 1) % verts.length];

        // Edge direction on XZ plane
        const dx = v2.x - v1.x;
        const dz = v2.z - v1.z;
        const edgeLen = Math.hypot(dx, dz);
        if (edgeLen < 0.001) continue;

        // Normal pointing outward (away from polygon center)
        let nx = -dz / edgeLen;
        let nz = dx / edgeLen;

        // Check if normal points outward (away from center)
        const midX = (v1.x + v2.x) / 2;
        const midZ = (v1.z + v2.z) / 2;
        const toCenterX = cx - midX;
        const toCenterZ = cz - midZ;
        if (nx * toCenterX + nz * toCenterZ > 0) {
          nx = -nx;
          nz = -nz;
        }

        // Determine if wall start/end are corners (shared vertex with adjacent walls).
        // Full corner rule (300+600 / 300 overrun) only for L-shaped (~90°) corners; else use pattanko.
        const isStartCorner = !isOpenPolygon || i > 0;
        const isEndCorner = !isOpenPolygon || i < walls.length - 1;
        const isStartLShaped = isStartCorner && (isLShapedAtStart[i] ?? false);
        const isEndLShaped = isEndCorner && (isLShapedAtEnd[i] ?? false);

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
        const useCornerExtension = walls.length >= 2 && !isOpenPolygon && isEndLShaped;
        const useStartCornerExtension = walls.length >= 2 && !isOpenPolygon && isStartLShaped;
        const cornerExtensionM = CORNER_OVERRUN_M + CORNER_TURN_SPAN_M;
        const baseLen = Math.max(runLenM, 1e-6);
        let desiredLen = edgeLen;
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

        const edgeDirX = dx / edgeLen;
        const edgeDirZ = dz / edgeLen;

        // Translation: place scaffold so near row is at building + standoff (250–500mm)
        const tx = (v1.x - cx) + nx * standoffM;
        const tz = (v1.z - cz) + nz * standoffM;

        // Build a transformation matrix (Three.js Matrix4 uses column-major internally,
        // but .set() takes row-major arguments):
        // Row 0: local X → (edgeDirX, 0, edgeDirZ) maps to world XZ
        // Row 1: local Y → (0, 1, 0) stays up
        // Row 2: local Z → (nx, 0, nz) maps to outward normal
        const matrix = new THREE.Matrix4();
        matrix.set(
          edgeDirX, 0, nx, tx,
          0,        1, 0,  0,
          edgeDirZ, 0, nz, tz,
          0,        0, 0,  1,
        );

        wallRoot.applyMatrix4(matrix);
        scene.add(wallRoot);
        wallRenderInfos[i] = { root: wallRoot, postX, widthM, spansMm, startPostIdx };

        // Track extents
        const levels = wall.levelCalc.fullLevels;
        const levelsShown = levels;
        const totalH = GROUND_Y + JACK_H + levelsShown * LEVEL_H + (levelsShown >= levels ? topGuardM : 0);
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
            firstSpanDeck.moveTo(r1.x, r1.z);
            firstSpanDeck.lineTo(t1.x, t1.z);
            firstSpanDeck.lineTo(t2.x, t2.z);
            firstSpanDeck.lineTo(r2.x, r2.z);
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
      const outlineMat = new THREE.LineBasicMaterial({ color: 0x7a8090, linewidth: 2 });
      const outlinePts = verts.map(v => new THREE.Vector3(v.x - cx, GROUND_Y + 0.01, v.z - cz));
      if (!isOpenPolygon) {
        outlinePts.push(outlinePts[0].clone());
      }
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outlineLine = new THREE.Line(outlineGeo, outlineMat);
      scene.add(outlineLine);

      // Building fill — visible solid mass so scaffold reads as wrapping a real building
      if (!isOpenPolygon && verts.length >= 3) {
        const shape = new THREE.Shape();
        shape.moveTo(verts[0].x - cx, verts[0].z - cz);
        for (let i = 1; i < verts.length; i++) {
          shape.lineTo(verts[i].x - cx, verts[i].z - cz);
        }
        shape.closePath();
        const buildingH = Math.max(maxH * 0.85, 2);
        const buildingGeo = new THREE.ExtrudeGeometry(shape, { depth: buildingH, bevelEnabled: false });
        const buildingMat = new THREE.MeshStandardMaterial({
          color: 0xe8e0d8, metalness: 0, roughness: 0.85,
          transparent: true, opacity: 0.45, side: THREE.DoubleSide,
        });
        const buildingMesh = new THREE.Mesh(buildingGeo, buildingMat);
        buildingMesh.rotation.x = -Math.PI / 2;
        buildingMesh.position.y = GROUND_Y + 0.02;
        buildingMesh.userData = { noClip: true };
        scene.add(buildingMesh);
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
  }, [walls, result?.scaffoldWidthMm, result?.topGuardHeightMm, result?.polygonVertices, result?.wallStandoffMm, isAiBim, technicalMode, t]);

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
