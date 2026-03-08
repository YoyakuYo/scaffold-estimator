'use client';

import { useRef, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, FileText, FileCode, Box, Download, Plus, Info } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { WallCalculationResult, CalculatedComponent } from '@/lib/api/scaffold-configs';
import { scaffoldConfigsApi } from '@/lib/api/scaffold-configs';
import html2canvas from 'html2canvas';
import {
  loadScaffoldTextures,
  addRealisticPost,
  addRealisticJack,
  addRealisticPlank,
  addRealisticNunoBar,
  addRealisticBrace,
  addRealisticHabaki,
} from '@/lib/scaffold-3d-components';

/**
 * 3D Scaffold View — Arbitrary Polygon Layout
 * Building is one closed polygon; scaffold is one continuous closed perimeter (shared corner posts).
 * Supports any number of walls (not just N/S/E/W).
 */

const PIPE_R = 0.024;
const PIPE_SEG = 10;
const LEVEL_H_KUSABI = 1.8;
const JACK_H = 0.3;
const NEGR_H = 0.2;
type ViewMode = 'all' | 'wall';

// Technical palette (distinct per component for estimation/quotation)
const C_TECH = {
  post: 0x0f172a, brace: 0xb91c1c, tesuri: 0x1d4ed8, shitasan: 0x0e7490,
  plank: 0xb45309, habaki: 0x44403c, jack: 0x334155, yokoji: 0x15803d,
  topGuard: 0x6d28d9, frame: 0x4f46e5, endStopper: 0x7c3aed, stair: 0x047857,
};
// Clean scaffold palette: light silver/grey metal, bright yellow planks
const C = {
  pipe:       0xc0c8d0,
  pipeDark:   0xa8b0b8,
  plank:      0xf5c842,
  plankEdge:  0xe8b428,
  jackBase:   0xb0b8c0,
  basePlate:  0xa8b0b8,
  stair:      0xc0c8d0,
  stairRail:  0xb8c0c8,
  habaki:     0xc0c8d0,
  frame:      0xc0c8d0,
  frameDark:  0xa0a8b0,
  ground:     0xe0e4e8,
  bg:         0xd8dce0,
  grid:       0xd0d8e0,
  ambient:    0xffffff,
  dirLight:   0xffffff,
  wood:       0xc4a574,
};

// Per-wall accent colors (for edge/click hint only)
const WALL_COLORS_HEX = [
  0x3b82f6, 0xf59e0b, 0x10b981, 0xec4899,
  0x8b5cf6, 0xef4444, 0x06b6d4, 0x84cc16,
  0xf97316, 0x6366f1,
];

// Span size (mm) → plank color (bright yellow; single tone for clean look)
const SPAN_COLORS: Record<number, number> = {
  600: 0xf5c842,
  900: 0xf5c842,
  1200: 0xf5c842,
  1500: 0xf5c842,
  1800: 0xf5c842,
};
const STANDARD_SPANS = [600, 900, 1200, 1500, 1800];

/**
 * Build polygon vertices from stored vertices or regular polygon fallback.
 * Returns 3D positions on XZ plane (in meters). Always NaN-safe.
 * Stored vertices may be: (a) mm — divide by 1000; (b) 0–1 fraction (e.g. image outline) — scale to meters from wall lengths; (c) already meters.
 */
function buildPolygonVertices(
  walls: WallCalculationResult[],
  storedVertices?: Array<{ xFrac: number; yFrac: number }>,
): { x: number; z: number }[] {
  const n = walls.length;
  if (n < 1) return [];

  // ── 1 wall: single edge (2 vertices) ──
  if (n === 1) {
    const lenM = Math.max(walls[0].wallLengthMm, 600) / 1000;
    return [{ x: 0, z: 0 }, { x: lenM, z: 0 }];
  }

  // ── 2 walls: L-shape (3 vertices) ──
  if (n === 2) {
    const len0 = Math.max(walls[0].wallLengthMm, 600) / 1000;
    const len1 = Math.max(walls[1].wallLengthMm, 600) / 1000;
    return [{ x: 0, z: 0 }, { x: len0, z: 0 }, { x: len0, z: len1 }];
  }

  // ── Use actual polygon vertices if available & valid ──
  if (storedVertices && storedVertices.length >= n) {
    const raw = storedVertices.slice(0, n).map(v => ({
      x: Number.isFinite(v.xFrac) ? v.xFrac : 0,
      z: Number.isFinite(v.yFrac) ? v.yFrac : 0,
    }));
    const xs = raw.map(v => v.x);
    const zs = raw.map(v => v.z);
    const spread = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
    );
    // Don't return [] for degenerate outline — fall through to length-based fallback so 3D still renders
    if (spread >= 1e-6) {

    // Detect units: fraction 0–1 (e.g. from image outline), mm, or meters
    const maxCoord = Math.max(Math.max(...xs), Math.max(...zs));
    let verts: { x: number; z: number }[];

    if (maxCoord <= 1.1 && spread <= 1.1) {
      // Likely 0–1 fraction: scale to meters using max wall length as reference
      const refM = Math.max(...walls.map(w => Math.max(w.wallLengthMm, 600))) / 1000;
      const scale = refM / Math.max(spread, 0.001);
      verts = raw.map(v => ({ x: v.x * scale, z: v.z * scale }));
    } else if (spread > 1000 || maxCoord > 1000) {
      // Likely mm
      verts = raw.map(v => ({ x: v.x / 1000, z: v.z / 1000 }));
    } else {
      // Assume already in meters (e.g. fallback from another path)
      verts = raw.map(v => ({ x: v.x, z: v.z }));
    }

    const spreadM = Math.max(
      Math.max(...verts.map(v => v.x)) - Math.min(...verts.map(v => v.x)),
      Math.max(...verts.map(v => v.z)) - Math.min(...verts.map(v => v.z)),
    );
    if (spreadM > 0.01) return verts;
    }
  }

  // ── Fallback: place walls as a rectangle (4 walls) or regular polygon ──
  if (n === 4) {
    // For 4 walls, assume rectangle: sides 0,2 are parallel, 1,3 are parallel
    const w0 = Math.max(walls[0].wallLengthMm, 600) / 1000;
    const w1 = Math.max(walls[1].wallLengthMm, 600) / 1000;
    return [
      { x: 0, z: 0 },
      { x: w0, z: 0 },
      { x: w0, z: w1 },
      { x: 0, z: w1 },
    ];
  }

  // Generic: place walls at equal turning angles (best-effort)
  const extAngle = (2 * Math.PI) / n;
  let angle = 0;
  let cx = 0, cz = 0;
  const verts: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    verts.push({ x: cx, z: cz });
    const lenM = Math.max(walls[i].wallLengthMm, 600) / 1000;
    cx += lenM * Math.cos(angle);
    cz += lenM * Math.sin(angle);
    angle += extAngle;
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
  maxVisibleLevel?: number;
  totalLevels?: number;
  onVisibleLevelsChange?: (levels: number) => void;
  levelSummary?: { totalLevels: number; visibleLevels: number; summary: CalculatedComponent[] };
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
  maxVisibleLevel,
  totalLevels = 1,
  onVisibleLevelsChange,
  levelSummary,
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
  const wallObjectsRef = useRef<Array<{ root: any; label: any; edge: any }>>([]);
  const wallFocusRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  const clickTargetsRef = useRef<any[]>([]);
  const componentMeshesRef = useRef<any[]>([]);
  const controlsRef = useRef<any>(null);

  const effectiveMaxLevel = maxVisibleLevel != null ? Math.max(1, Math.min(maxVisibleLevel, totalLevels || 1)) : undefined;
  const isAiBim = complianceMode === 'ai_bim';

  // Support both flat (result.walls) and nested (result.result.walls) API shapes
  const walls: WallCalculationResult[] =
    (result?.walls ?? (result as any)?.result?.walls) ?? [];

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
    if (!canvasContainerRef.current || !wrapperRef.current || walls.length === 0) return;

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

      // ── Scene ──────────────────────────────────────────
      const scene = new THREE.Scene();
      // Plain light gray background (clean, uncluttered look)
      scene.background = new THREE.Color(C.bg);
      // No fog — keep view clear and clean
      sceneRef.current = scene;
      wallObjectsRef.current = [];
      wallFocusRef.current = [];
      clickTargetsRef.current = [];
      componentMeshesRef.current = [];
      const maxLevelCap = effectiveMaxLevel;

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
      renderer.toneMappingExposure = 1.05;
      if ('outputColorSpace' in renderer) {
        (renderer as any).outputColorSpace = THREE.SRGBColorSpace;
      }
      canvasElement = renderer.domElement;
      canvasContainer.appendChild(canvasElement as unknown as Node);

      // ── Lights (realistic metallic highlights) ─────────
      const ambientLight = new THREE.AmbientLight(C.ambient, 0.9);
      scene.add(ambientLight);

      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8ecae6, 0.6);
      scene.add(hemiLight);

      const dirLight = new THREE.DirectionalLight(C.dirLight, 1.4);
      dirLight.position.set(18, 22, 12);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.bias = -0.0001;
      scene.add(dirLight);

      const fillLight = new THREE.DirectionalLight(0xe8f4fc, 0.6);
      fillLight.position.set(-14, 8, -10);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
      rimLight.position.set(-8, 15, 15);
      scene.add(rimLight);

      const isTech = technicalQuotationMode;
      const metal = isTech ? 0.45 : 0.88;
      const rough = isTech ? 0.5 : 0.22;

      // ── Shared materials ───
      const pipeMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.post : C.pipe,
        metalness: metal,
        roughness: rough,
      });
      const pipeDarkMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.brace : C.pipeDark,
        metalness: metal,
        roughness: rough,
      });
      // Planks always bright yellow for clean reference look (ignore technical brown)
      const plankMat = new THREE.MeshStandardMaterial({
        color: C.plank,
        metalness: metal,
        roughness: rough,
      });
      const spanPlankMats: Record<number, THREE.MeshStandardMaterial> = {};
      for (const span of STANDARD_SPANS) {
        spanPlankMats[span] = new THREE.MeshStandardMaterial({
          color: SPAN_COLORS[span] ?? C.plank,
          metalness: metal,
          roughness: rough,
        });
      }
      const getPlankMat = (spanMm: number): THREE.MeshStandardMaterial => {
        const closest = STANDARD_SPANS.reduce((a, b) =>
          Math.abs(a - spanMm) <= Math.abs(b - spanMm) ? a : b
        );
        return spanPlankMats[closest] ?? plankMat;
      };
      const jackMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.jack : C.jackBase,
        metalness: metal,
        roughness: rough,
      });
      const habakiMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.habaki : C.habaki,
        metalness: metal,
        roughness: rough,
      });
      const stairMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.stair : C.stair,
        metalness: metal,
        roughness: rough,
      });
      const groundMat = new THREE.MeshStandardMaterial({ color: C.ground, metalness: 0, roughness: 0.95 });
      const frameMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.frame : C.frame,
        metalness: metal,
        roughness: rough,
      });
      const frameDarkMat = new THREE.MeshStandardMaterial({
        color: isTech ? C_TECH.brace : C.frameDark,
        metalness: metal,
        roughness: rough,
      });
      const woodMat = new THREE.MeshStandardMaterial({ color: C.wood, metalness: 0.05, roughness: 0.9 });

      // Effective materials: generic post/plank (no texture overlays); technical mode = distinct flat colors
      const postMat = pipeMat;
      const jackMatEff = isTech ? jackMat : (textures.jack ?? jackMat);
      const plankMatEff = plankMat;
      const nunoMat = isTech ? new THREE.MeshStandardMaterial({ color: C_TECH.tesuri, metalness: metal, roughness: rough }) : (textures.nuno ?? pipeMat);
      const yokojiMat = isTech ? new THREE.MeshStandardMaterial({ color: C_TECH.yokoji, metalness: metal, roughness: rough }) : nunoMat;
      const topGuardMat = isTech ? new THREE.MeshStandardMaterial({ color: C_TECH.topGuard, metalness: metal, roughness: rough }) : nunoMat;
      const shitasanMat = isTech ? new THREE.MeshStandardMaterial({ color: C_TECH.shitasan, metalness: metal, roughness: rough }) : nunoMat;
      const braceMat = isTech ? pipeDarkMat : (textures.brace ?? pipeDarkMat);
      const habakiMatEff = isTech ? habakiMat : (textures.habaki ?? habakiMat);

      const widthM = result.scaffoldWidthMm / 1000;
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

      function addJoint(parent: THREE.Object3D, x: number, y: number, z: number) {
        const geo = new THREE.CylinderGeometry(PIPE_R * 2.5, PIPE_R * 2.5, 0.02, 12);
        const mesh = new THREE.Mesh(geo, pipeDarkMat);
        mesh.position.set(x, y, z);
        parent.add(mesh);
      }

      /**
       * Renders a wakugumi portal frame (建枠) at position (px, baseY) spanning from z=0 to z=widthM.
       * Shape: two vertical legs + horizontal top bar + curved outward bottom legs.
       * Based on FT-917/FT-1217C specs: 329mm bottom curve, 1219mm straight, 152mm top bar.
       */
      function addWakugumiFrame(
        parent: THREE.Object3D,
        px: number,
        baseY: number,
        frameH: number,
        wid: number,
        fr = PIPE_R * 1.15,
      ) {
        const bottomRatio = 0.194;
        const topBarRatio = 0.089;
        const bottomH = frameH * bottomRatio;
        const topBarH = frameH * topBarRatio;
        const straightH = frameH - bottomH - topBarH;
        const splayOut = 0.04;

        // Bottom curved legs (splay outward then go vertical)
        const legBotY = baseY;
        const legStraightY = baseY + bottomH;
        const legTopY = legStraightY + straightH;
        const frameTopY = legTopY + topBarH;

        for (const pz of [0, wid]) {
          const outerZ = pz === 0 ? pz - splayOut : pz + splayOut;
          // Bottom curved/angled section (foot splays outward)
          addPipe(parent, px, legBotY, outerZ, px, legStraightY, pz, frameMat, fr);
          // Straight vertical section
          addPipe(parent, px, legStraightY, pz, px, legTopY, pz, frameMat, fr);
          // Top short vertical into crossbar
          addPipe(parent, px, legTopY, pz, px, frameTopY, pz, frameMat, fr);

          // Joint rings at transitions
          const jGeo = new THREE.CylinderGeometry(fr * 2, fr * 2, 0.012, 10);
          const jBot = new THREE.Mesh(jGeo, frameDarkMat);
          jBot.position.set(px, legStraightY, pz);
          parent.add(jBot);
          const jTop = new THREE.Mesh(jGeo.clone(), frameDarkMat);
          jTop.position.set(px, legTopY, pz);
          parent.add(jTop);
        }

        // Top horizontal crossbar connecting front and back legs
        addPipe(parent, px, frameTopY, 0, px, frameTopY, wid, frameDarkMat, fr * 1.1);
        // Mid-crossbar for structural look
        const midCrossY = legStraightY + straightH * 0.5;
        addPipe(parent, px, midCrossY, 0, px, midCrossY, wid, frameDarkMat, fr * 0.6);
      }

      // ══════════════════════════════════════════════════════
      // BUILD SCAFFOLD FOR ONE WALL (local coordinates: along X axis, depth along Z)
      // maxLevelCap: when set, only build up to that level (level-by-level visualization)
      // hasNextWall: when true, add corner inner post and split last-span tesuri for clean joint
      // ══════════════════════════════════════════════════════
      function buildWallScaffold(wall: WallCalculationResult, group: THREE.Group, maxSpans?: number, maxLevelCap?: number, hasNextWall?: boolean) {
        const allSpans: number[] = wall.spans;
        const spans = maxSpans != null && maxSpans < allSpans.length
          ? allSpans.slice(0, maxSpans)
          : allSpans;
        const postX: number[] = [0];
        let acc = 0;
        for (const s of spans) { acc += s / 1000; postX.push(acc); }
        const totalLen = postX[postX.length - 1] || 0;
        const levels = wall.levelCalc.fullLevels;
        const levelsToBuild = maxLevelCap != null ? Math.min(levels, maxLevelCap) : levels;
        // Post height ends at top plank level; small cap above so posts don't extend far beyond last span
        const postCapAbovePlank = levelsToBuild >= levels ? Math.min(topGuardM, 0.2) : 0;
        const totalPostH = levelsToBuild * LEVEL_H + postCapAbovePlank;

        // Corner joint: extra inner post at (totalLen - widthM); last-span tesuri shortened to (lastSpan - width)
        const lastSpanM = spans.length > 0 ? spans[spans.length - 1] / 1000 : 0;
        const useCornerJoint = !!hasNextWall && spans.length > 0 && totalLen > widthM && lastSpanM > widthM;
        const cornerInnerPostX = useCornerJoint ? totalLen - widthM : null as number | null;

        const kaidanSpanIndices = wall.kaidanSpanIndices || [];

        // ── Wooden base sleepers (foundation timbers) ─────
        const sleeperH = 0.08;
        const sleeperW = 0.2;
        const sleeperLen = totalLen + 0.4;
        for (const pz of [0, widthM / 2, widthM]) {
          addBox(group, totalLen / 2, sleeperH / 2, pz, sleeperLen, sleeperH, sleeperW, woodMat);
        }

        // ── Jack bases + base plates ───────────────────
        for (const px of postX) {
          for (const pz of [0, widthM]) {
            addRealisticJack(THREE, group, px, 0.005, pz, jackMatEff, PIPE_R * 0.7, JACK_H);
            const colGeo = new THREE.CylinderGeometry(PIPE_R * 1.8, PIPE_R * 1.8, 0.04, 12);
            const colMesh = new THREE.Mesh(colGeo, jackMatEff);
            colMesh.position.set(px, JACK_H, pz);
            group.add(colMesh);
          }
        }

        // ── Vertical posts / frames ──────────────────
        if (isWakugumi) {
          for (const px of postX) {
            for (let lv = 0; lv < levelsToBuild; lv++) {
              const frameBaseY = JACK_H + lv * LEVEL_H;
              addWakugumiFrame(group, px, frameBaseY, LEVEL_H, widthM);
            }
          }
        } else {
          for (const px of postX) {
            for (const pz of [0, widthM]) {
              addRealisticPost(THREE, group, px, JACK_H, pz, totalPostH, postMat);
              for (let lv = 0; lv <= levelsToBuild; lv++) {
                addJoint(group, px, JACK_H + lv * LEVEL_H, pz);
              }
              if (levelsToBuild >= levels) addJoint(group, px, JACK_H + totalPostH, pz);
            }
          }
          // Corner joint: one extra post on inner row only (between last span, for next wall connection)
          if (cornerInnerPostX != null) {
            addRealisticJack(THREE, group, cornerInnerPostX, 0.005, 0, jackMatEff, PIPE_R * 0.7, JACK_H);
            const colGeo = new THREE.CylinderGeometry(PIPE_R * 1.8, PIPE_R * 1.8, 0.04, 12);
            const colMesh = new THREE.Mesh(colGeo, jackMatEff);
            colMesh.position.set(cornerInnerPostX, JACK_H, 0);
            group.add(colMesh);
            addRealisticPost(THREE, group, cornerInnerPostX, JACK_H, 0, totalPostH, postMat);
            for (let lv = 0; lv <= levelsToBuild; lv++) {
              addJoint(group, cornerInnerPostX, JACK_H + lv * LEVEL_H, 0);
            }
            if (levelsToBuild >= levels) addJoint(group, cornerInnerPostX, JACK_H + totalPostH, 0);
          }
        }

        // ── 根がらみ (Base yokoji) ─────────────────────
        const baseY = JACK_H + NEGR_H;
        for (let i = 0; i < spans.length; i++) {
          const x1 = postX[i];
          const x2 = postX[i + 1];
          for (const pz of [0, widthM]) {
            addRealisticNunoBar(THREE, group, x1, baseY, pz, x2, pz, yokojiMat);
          }
        }
        for (const px of postX) {
          addRealisticNunoBar(THREE, group, px, baseY, 0, px, widthM, yokojiMat);
        }
        // Corner: 600mm (widthM) negarami at base on inner row from added post to last post
        if (cornerInnerPostX != null) {
          addRealisticNunoBar(THREE, group, cornerInnerPostX, baseY, 0, totalLen, 0, yokojiMat);
        }

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

        // ── Per-level components ───────────────────────
        for (let lv = 1; lv <= levelsToBuild; lv++) {
          const y = JACK_H + lv * LEVEL_H;

          // Width yokoji
          for (const px of postX) {
            addRealisticNunoBar(THREE, group, px, y, 0, px, widthM, yokojiMat);
          }
          if (cornerInnerPostX != null) {
            addRealisticNunoBar(THREE, group, cornerInnerPostX, y, 0, totalLen, 0, yokojiMat);
          }

          for (let i = 0; i < spans.length; i++) {
            const x1 = postX[i];
            const x2 = postX[i + 1];
            const spanM = spans[i] / 1000;
            const midX = (x1 + x2) / 2;
            const baseYLv = JACK_H + (lv - 1) * LEVEL_H;
            const isStairSpan = uniqueStairPos.includes(i);
            const isLastSpanWithCorner = cornerInnerPostX != null && i === spans.length - 1;
            const tesuriEndX = isLastSpanWithCorner ? cornerInnerPostX : x2;

            if (isWakugumi) {
              // ── Wakugumi: Brace on BOTH faces ──
              addRealisticBrace(THREE, group, x1, baseYLv, 0, x2, y, braceMat);
              addRealisticBrace(THREE, group, x1, baseYLv, widthM, x2, y, braceMat);

              // 下桟 (Shitasan) — bottom horizontal, both faces
              const shitasanY = baseYLv + 0.05;
              addRealisticNunoBar(THREE, group, x1, shitasanY, 0, x2, 0, shitasanMat);
              addRealisticNunoBar(THREE, group, x1, shitasanY, widthM, x2, widthM, shitasanMat);
            } else {
              // ── Kusabi: Brace on OUTER face (z=widthM), handrails/tesuri on INNER face (z=0) ──
              addRealisticBrace(THREE, group, x1, baseYLv, widthM, x2, y, braceMat);

              // INNER face — Tesuri/Nuno (z = 0). Last span with corner: only up to corner post (e.g. 1200mm)
              if (isAiBim) {
                const midRailY = baseYLv + 0.45;
                const handrailY = baseYLv + 0.85;
                addRealisticNunoBar(THREE, group, x1, midRailY, 0, tesuriEndX, 0, nunoMat);
                addRealisticNunoBar(THREE, group, x1, handrailY, 0, tesuriEndX, 0, nunoMat);
                const ledger1200Y = baseYLv + 1.2;
                addPipe(group, x1, ledger1200Y, 0, x2, ledger1200Y, 0, pipeDarkMat, PIPE_R * 0.75);
                addPipe(group, x1, ledger1200Y, widthM, x2, ledger1200Y, widthM, pipeDarkMat, PIPE_R * 0.75);
              } else {
                const tesuriY1 = baseYLv + LEVEL_H * 0.5;
                const tesuriY2 = y;
                addRealisticNunoBar(THREE, group, x1, tesuriY1, 0, tesuriEndX, 0, nunoMat);
                addRealisticNunoBar(THREE, group, x1, tesuriY2, 0, tesuriEndX, 0, nunoMat);
              }
              // Corner: 600mm (widthM) bar at plank level from last inner post to added post
              if (isLastSpanWithCorner) {
                addRealisticNunoBar(THREE, group, cornerInnerPostX!, y + 0.015, 0, totalLen, 0, nunoMat);
              }
            }

            // Plank / Anchi — always yellow (reference look); generic, no texture
            const spanMm = spans[i];
            const plankColorMat = getPlankMat(spanMm);
            if (!isStairSpan) {
              addRealisticPlank(THREE, group, midX, y + 0.015, widthM / 2, spanM - 0.04, widthM * 0.9, plankColorMat);
              addRealisticHabaki(THREE, group, midX, y + 0.015, widthM * 0.05, spanM - 0.04, habakiMatEff);
              addRealisticHabaki(THREE, group, midX, y + 0.015, widthM * 0.95, spanM - 0.04, habakiMatEff);
            }

            // Habaki / Toe boards
            addRealisticHabaki(THREE, group, midX, y + 0.06, 0, spanM - 0.04, habakiMatEff);
            addRealisticHabaki(THREE, group, midX, y + 0.06, widthM, spanM - 0.04, habakiMatEff);
          }
        }

        // ── Top guard rails (at capped post height so posts don't extend beyond last span) ────────────────────────────
        const topH = JACK_H + levelsToBuild * LEVEL_H;
        const guardH = topH + postCapAbovePlank;
        for (let i = 0; i < spans.length; i++) {
          const x1 = postX[i];
          const x2 = postX[i + 1];
          for (const pz of [0, widthM]) {
            addRealisticNunoBar(THREE, group, x1, guardH, pz, x2, pz, topGuardMat);
            addRealisticNunoBar(THREE, group, x1, topH + postCapAbovePlank * 0.5, pz, x2, pz, topGuardMat);
          }
        }
        if (cornerInnerPostX != null) {
          addRealisticNunoBar(THREE, group, cornerInnerPostX, guardH, 0, totalLen, 0, topGuardMat);
          addRealisticNunoBar(THREE, group, cornerInnerPostX, topH + postCapAbovePlank * 0.5, 0, totalLen, 0, topGuardMat);
        }

        // ── Stairs ─────────────────────────────────────
        const RAIL_H_ABOVE = 0.9;
        const NUM_STEPS = 8;

        for (let lv = 1; lv <= levelsToBuild; lv++) {
          if (uniqueStairPos.length === 0) continue;
          for (const stairSpanIdx of uniqueStairPos) {
          if (stairSpanIdx >= spans.length) continue;
          const sx1 = postX[stairSpanIdx];
          const sx2 = postX[stairSpanIdx + 1];

          const stairZfront = 0.05;
          const stairZback  = widthM - 0.05;
          const stairZcenter = (stairZfront + stairZback) / 2;

          const btmY = JACK_H + (lv - 1) * LEVEL_H + 0.04;
          const topYStair = JACK_H + lv * LEVEL_H + 0.04;
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

          // Handrails
          for (const hz of [stairZfront - 0.03, stairZback + 0.03]) {
            addPipe(group, sStartX, btmY + RAIL_H_ABOVE, hz, sEndX, topYStair + RAIL_H_ABOVE, hz, pipeMat, PIPE_R * 0.7);
            addPipe(group, sStartX, btmY + RAIL_H_ABOVE * 0.5, hz, sEndX, topYStair + RAIL_H_ABOVE * 0.5, hz, pipeMat, PIPE_R * 0.6);
          }

          // Vertical supports
          const NUM_VERTICALS = 4;
          for (let v = 0; v <= NUM_VERTICALS; v++) {
            const vt = v / NUM_VERTICALS;
            const vx = sStartX + (sEndX - sStartX) * vt;
            const vy = btmY + (topYStair - btmY) * vt;
            for (const vz of [stairZfront - 0.03, stairZback + 0.03]) {
              addPipe(group, vx, vy, vz, vx, vy + RAIL_H_ABOVE, vz, pipeMat, PIPE_R * 0.5);
            }
          }
          } // end for stairSpanIdx
        }
      }

      // ══════════════════════════════════════════════════════
      // BUILD POLYGON VERTICES & POSITION WALLS
      // ══════════════════════════════════════════════════════
      const storedVerts: Array<{ xFrac: number; yFrac: number }> | undefined =
        result?.polygonVertices;
      const verts = buildPolygonVertices(walls, storedVerts);
      if (verts.length < 2) {
        setError('Need at least 1 wall to build 3D view');
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

      // Store per-wall outward normals so we can build corner connectors afterwards
      const wallNormals: Array<{ nx: number; nz: number }> = [];

      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const v1 = verts[i];
        const v2 = verts[(i + 1) % verts.length];

        // Edge direction on XZ plane
        const dx = v2.x - v1.x;
        const dz = v2.z - v1.z;
        const edgeLen = Math.hypot(dx, dz);
        if (edgeLen < 0.001) { wallNormals.push({ nx: 0, nz: 0 }); continue; }

        // Normal pointing outward (away from polygon center)
        let nx = -dz / edgeLen;
        let nz = dx / edgeLen;

        // Check if normal points outward (away from center)
        const midX = (v1.x + v2.x) / 2;
        const midZ = (v1.z + v2.z) / 2;
        const toCenterX = cx - midX;
        const toCenterZ = cz - midZ;
        if (nx * toCenterX + nz * toCenterZ > 0) {
          // Normal points inward, flip it
          nx = -nx;
          nz = -nz;
        }
        wallNormals.push({ nx, nz });

        // Build scaffold in local space (along X, depth along Z)
        const wallRoot = new THREE.Group();
        const group = new THREE.Group();
        wallRoot.add(group);
        const hasNextWall = walls.length > 1;
        buildWallScaffold(wall, group, spanCaps[i], maxLevelCap, hasNextWall);

        // Scale scaffold to fit exactly on polygon edge so corners join (closed perimeter).
        // Manual and DXF: edge length from polygon; wall length from spans — scale so end meets next vertex.
        const spansUsed = spanCaps[i] != null && spanCaps[i] < wall.spans.length
          ? wall.spans.slice(0, spanCaps[i])
          : wall.spans;
        const totalLen = spansUsed.length > 0
          ? spansUsed.reduce((s, sp) => s + sp, 0) / 1000
          : edgeLen;
        if (totalLen > 0.001) {
          const scaleX = edgeLen / totalLen;
          group.scale.set(scaleX, 1, 1);
        }

        // The wall scaffold is built in local space:
        //   local X = along wall length (0 to totalLen)
        //   local Z = scaffold depth (0 = outer face, widthM = inner face)
        //   local Y = height (up)
        //
        // We need to transform so that:
        //   local X → edge direction
        //   local Z → outward normal direction
        //   local Y → world Y (up)
        //   origin → v1 (centered) + outward offset for outer face

        const edgeDirX = dx / edgeLen;
        const edgeDirZ = dz / edgeLen;

        // Translation: place origin at v1 (centered), offset outward by widthM
        // so that local z=widthM (inner face) touches the building edge
        const tx = (v1.x - cx) + nx * widthM;
        const tz = (v1.z - cz) + nz * widthM;

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

        // Track extents
        const levels = wall.levelCalc.fullLevels;
        const levelsShown = maxLevelCap != null ? Math.min(levels, maxLevelCap) : levels;
        const totalH = JACK_H + levelsShown * LEVEL_H + (levelsShown >= levels ? topGuardM : 0);
        if (totalH > maxH) maxH = totalH;

        const dist = Math.hypot(v1.x - cx, v1.z - cz);
        if (dist + widthM > maxExtent) maxExtent = dist + widthM;

        // Visible edge segment for click target hint
        const edgePts = [
          new THREE.Vector3(v1.x - cx, 0.14, v1.z - cz),
          new THREE.Vector3(v2.x - cx, 0.14, v2.z - cz),
        ];
        const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePts);
        const edgeMat = new THREE.LineBasicMaterial({
          color: WALL_COLORS_HEX[i % WALL_COLORS_HEX.length],
          transparent: true,
          opacity: 0.95,
        });
        const edgeLine = new THREE.Line(edgeGeo, edgeMat);
        scene.add(edgeLine);

        // Invisible hit area to allow clicking each wall segment. Use ~85% of edge length
        // so two adjacent walls' boxes do not overlap at corners (avoids a visible "vertical plank" artifact).
        const clickBoxLen = Math.max(edgeLen * 0.85, 0.3);
        const clickGeo = new THREE.BoxGeometry(clickBoxLen, Math.max(totalH, 2), Math.max(widthM * 0.35, 0.35));
        const clickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
        const clickMesh = new THREE.Mesh(clickGeo, clickMat);
        clickMesh.position.set(
          (v1.x + v2.x) / 2 - cx + nx * (widthM * 0.42),
          Math.max(totalH, 2) / 2,
          (v1.z + v2.z) / 2 - cz + nz * (widthM * 0.42),
        );
        clickMesh.rotation.y = Math.atan2(dz, dx);
        (clickMesh as any).userData = { wallIndex: i };
        scene.add(clickMesh);

        wallObjectsRef.current.push({
          root: wallRoot,
          label: null,
          edge: edgeLine,
        });
        wallFocusRef.current.push({
          x: (v1.x + v2.x) / 2 - cx + nx * (widthM * 1.6),
          y: Math.max(totalH * 0.45, 2.2),
          z: (v1.z + v2.z) / 2 - cz + nz * (widthM * 1.6),
        });
        clickTargetsRef.current.push(clickMesh);
      }

      // ── Corner connectors: one closed polygon perimeter ──
      // Treat the building as a single closed loop. At each vertex use 2 shared posts (angle bisector)
      // so the scaffold is one continuous band: wall → shared corner post → next wall.
      const CORNER_SPAN_M = 0.6; // 600mm for corner bay anchi
      for (let j = 0; j < walls.length; j++) {
        const prevIdx = (j - 1 + walls.length) % walls.length;
        const nPrev = wallNormals[prevIdx];
        const nCurr = wallNormals[j];
        if ((nPrev.nx === 0 && nPrev.nz === 0) || (nCurr.nx === 0 && nCurr.nz === 0)) continue;

        const vx = verts[j].x - cx;
        const vz = verts[j].z - cz;

        // Wall-end positions (where prev wall ends and curr wall starts)
        const prevR0 = { x: vx + nPrev.nx * widthM, z: vz + nPrev.nz * widthM };
        const prevR1 = { x: vx + nPrev.nx * 2 * widthM, z: vz + nPrev.nz * 2 * widthM };
        const currR0 = { x: vx + nCurr.nx * widthM, z: vz + nCurr.nz * widthM };
        const currR1 = { x: vx + nCurr.nx * 2 * widthM, z: vz + nCurr.nz * 2 * widthM };

        // Outward angle bisector at this vertex (so one post position is shared by both walls)
        let bx = nPrev.nx + nCurr.nx;
        let bz = nPrev.nz + nCurr.nz;
        const blen = Math.hypot(bx, bz) || 1;
        bx /= blen;
        bz /= blen;
        // Ensure bisector points outward (away from polygon center). Center in local coords is (0,0).
        if (bx * vx + bz * vz < 0) {
          bx = -bx;
          bz = -bz;
        }
        // Shared corner posts: one outer, one inner (closed loop = 2 posts per vertex)
        const midOuter = { x: vx + bx * widthM, z: vz + bz * widthM };
        const midInner = { x: vx + bx * 2 * widthM, z: vz + bz * 2 * widthM };

        const prevLevels = walls[prevIdx].levelCalc.fullLevels;
        const currLevels = walls[j].levelCalc.fullLevels;
        let cornerLevels = Math.max(prevLevels, currLevels);
        if (maxLevelCap != null) cornerLevels = Math.min(cornerLevels, maxLevelCap);
        const cornerCap = Math.min(topGuardM, 0.2);
        const cornerH = JACK_H + cornerLevels * LEVEL_H + cornerCap;

        // Two vertical posts at this vertex (shared by both walls — closed polygon)
        for (const p of [midOuter, midInner]) {
          addRealisticPost(THREE, scene, p.x, JACK_H, p.z, cornerH - JACK_H, postMat);
        }

        // Horizontal pipes: close the loop (prev wall → shared corner → curr wall) + width
        const heights = [JACK_H + NEGR_H];
        for (let lv = 1; lv <= cornerLevels; lv++) heights.push(JACK_H + lv * LEVEL_H);
        heights.push(cornerH);
        heights.push(JACK_H + cornerLevels * LEVEL_H + cornerCap * 0.5);

        for (const y of heights) {
          addPipe(scene, prevR0.x, y, prevR0.z, midOuter.x, y, midOuter.z, pipeDarkMat, PIPE_R * 0.8);
          addPipe(scene, midOuter.x, y, midOuter.z, currR0.x, y, currR0.z, pipeDarkMat, PIPE_R * 0.8);
          addPipe(scene, prevR1.x, y, prevR1.z, midInner.x, y, midInner.z, pipeDarkMat, PIPE_R * 0.8);
          addPipe(scene, midInner.x, y, midInner.z, currR1.x, y, currR1.z, pipeDarkMat, PIPE_R * 0.8);
          addPipe(scene, midOuter.x, y, midOuter.z, midInner.x, y, midInner.z, pipeDarkMat, PIPE_R * 0.9);
        }

        // Corner bay at each level: X-brace, anchi (踏板), habaki (巾木)
        for (let lv = 1; lv <= cornerLevels; lv++) {
          const baseYLv = JACK_H + (lv - 1) * LEVEL_H;
          const y = JACK_H + lv * LEVEL_H;
          const plankY = y + 0.015;

          // X-brace in corner (diagonals between shared posts and wall ends)
          addPipe(scene, prevR0.x, baseYLv, prevR0.z, midOuter.x, y, midOuter.z, pipeDarkMat, PIPE_R * 0.7);
          addPipe(scene, prevR0.x, y, prevR0.z, midOuter.x, baseYLv, midOuter.z, pipeDarkMat, PIPE_R * 0.7);
          addPipe(scene, midOuter.x, baseYLv, midOuter.z, currR0.x, y, currR0.z, pipeDarkMat, PIPE_R * 0.7);
          addPipe(scene, midOuter.x, y, midOuter.z, currR0.x, baseYLv, currR0.z, pipeDarkMat, PIPE_R * 0.7);
          addPipe(scene, prevR1.x, baseYLv, prevR1.z, midInner.x, y, midInner.z, pipeDarkMat, PIPE_R * 0.7);
          addPipe(scene, prevR1.x, y, prevR1.z, midInner.x, baseYLv, midInner.z, pipeDarkMat, PIPE_R * 0.7);
          addPipe(scene, midInner.x, baseYLv, midInner.z, currR1.x, y, currR1.z, pipeDarkMat, PIPE_R * 0.7);
          addPipe(scene, midInner.x, y, midInner.z, currR1.x, baseYLv, currR1.z, pipeDarkMat, PIPE_R * 0.7);

          // Full anchi (踏板): one plank in the corner bay
          const midX = (midOuter.x + midInner.x + prevR0.x + currR0.x) / 4;
          const midZ = (midOuter.z + midInner.z + prevR0.z + currR0.z) / 4;
          const angle = Math.atan2(bz, bx);
          const spanLen = Math.max(CORNER_SPAN_M - 0.04, 0.2);
          const plankW = Math.min(widthM * 0.9, 0.55);
          const geo = new THREE.BoxGeometry(spanLen, 0.03, plankW);
          const mesh = new THREE.Mesh(geo, plankMatEff);
          mesh.position.set(midX, plankY, midZ);
          mesh.rotation.y = angle;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          scene.add(mesh);
          // Habaki along outer and inner edges of corner (prev→mid→curr)
          const hY = y + 0.06;
          for (const [ax, az, bx2, bz2] of [
            [prevR0.x, prevR0.z, midOuter.x, midOuter.z],
            [midOuter.x, midOuter.z, currR0.x, currR0.z],
            [prevR1.x, prevR1.z, midInner.x, midInner.z],
            [midInner.x, midInner.z, currR1.x, currR1.z],
          ]) {
            const edgeLen = Math.hypot(bx2 - ax, bz2 - az);
            if (edgeLen < 0.02) continue;
            const hx = (ax + bx2) / 2;
            const hz = (az + bz2) / 2;
            const habakiGeo = new THREE.BoxGeometry(edgeLen - 0.02, 0.1, 0.015);
            const habakiMesh = new THREE.Mesh(habakiGeo, habakiMatEff);
            habakiMesh.position.set(hx, hY, hz);
            habakiMesh.rotation.y = Math.atan2(bz2 - az, bx2 - ax);
            habakiMesh.castShadow = true;
            habakiMesh.receiveShadow = true;
            scene.add(habakiMesh);
          }
        }
      }

      // ── Building outline at ground level (subtle gray) ─
      const outlineMat = new THREE.LineBasicMaterial({ color: 0x9ca3af, linewidth: 2 });
      const outlinePts = verts.map(v => new THREE.Vector3(v.x - cx, 0.01, v.z - cz));
      outlinePts.push(outlinePts[0].clone()); // close the loop
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outlineLine = new THREE.Line(outlineGeo, outlineMat);
      scene.add(outlineLine);

      // Building fill (semi-transparent)
      if (verts.length >= 3) {
        const shape = new THREE.Shape();
        shape.moveTo(verts[0].x - cx, verts[0].z - cz);
        for (let i = 1; i < verts.length; i++) {
          shape.lineTo(verts[i].x - cx, verts[i].z - cz);
        }
        shape.closePath();
        const shapeGeo = new THREE.ShapeGeometry(shape);
        const shapeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
        const shapeMesh = new THREE.Mesh(shapeGeo, shapeMat);
        shapeMesh.rotation.x = -Math.PI / 2;
        shapeMesh.position.y = 0.02;
        scene.add(shapeMesh);
      }

      // ── Ground plane with faint grid (clean look) ──────
      const groundSize = Math.max(maxExtent * 4 + 20, 100);
      const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
      const groundPlane = new THREE.Mesh(groundGeo, groundMat);
      groundPlane.rotation.x = -Math.PI / 2;
      groundPlane.position.y = -0.03;
      groundPlane.receiveShadow = true;
      scene.add(groundPlane);
      const gridDivisions = Math.min(40, Math.max(10, Math.floor(groundSize / 5)));
      const gridHelper = new THREE.GridHelper(groundSize, gridDivisions, 0xd0d4d8, 0xd8dce0);
      gridHelper.rotation.x = -Math.PI / 2;
      gridHelper.position.y = -0.02;
      (gridHelper.material as THREE.Material).opacity = 0.4;
      (gridHelper.material as THREE.Material).transparent = true;
      scene.add(gridHelper);

      // ── Camera position — fit everything in view ───────
      const extent = Math.max(maxExtent, 5);
      const dist = Math.max(extent * 2.2, maxH * 2, 12);
      const centerY = Math.max(maxH * 0.4, 2);
      camera.position.set(
        dist * 0.55,
        centerY + dist * 0.45,
        dist * 0.65,
      );
      camera.lookAt(0, centerY * 0.6, 0);
      camera.far = dist * 5;
      camera.updateProjectionMatrix();

      // ── Orbit Controls ───────────────────────────────
      const target = new THREE.Vector3(0, centerY * 0.6, 0);
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
  }, [walls, result?.scaffoldWidthMm, result?.topGuardHeightMm, result?.polygonVertices, effectiveMaxLevel, isAiBim, technicalMode, t]);

  useEffect(() => {
    applyWallVisibility(viewMode, activeWallIdx);
    if (viewMode === 'wall') focusCameraOnWall(activeWallIdx);
  }, [viewMode, activeWallIdx]);

  if (walls.length === 0) return <div className="text-gray-500 p-8">{t('result', 'noWallData')}</div>;

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
      const canvas = await html2canvas(wrapperRef.current, { backgroundColor: '#eef3f8', useCORS: true });
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
          <div className="text-xs text-gray-500">{t('result', 'dragHint')} / Click wall segment to focus</div>
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
          <span>1F, 2F… = floor per floor</span>
          <span className="text-gray-400">|</span>
          <span>Closed perimeter (one loop)</span>
        </div>
        {totalLevels != null && totalLevels > 0 && onVisibleLevelsChange && (
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs font-medium text-gray-600">表示階:</span>
            {Array.from({ length: totalLevels }, (_, i) => i + 1).map((lv) => (
              <button
                key={lv}
                onClick={() => onVisibleLevelsChange(lv)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  effectiveMaxLevel === lv
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {lv}F
              </button>
            ))}
            {effectiveMaxLevel != null && effectiveMaxLevel < totalLevels && (
              <button
                onClick={() => onVisibleLevelsChange(Math.min(totalLevels, (effectiveMaxLevel ?? 0) + 1))}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-dashed border-indigo-400 text-indigo-600 hover:bg-indigo-50"
              >
                <Plus className="h-3 w-3" /> +1F
              </button>
            )}
          </div>
        )}
        {levelSummary && (
          <div className="text-xs text-gray-600 mb-2 p-2 bg-white rounded border border-gray-200">
            <span className="font-medium">1F～{levelSummary.visibleLevels}F の累計: </span>
            {levelSummary.summary.slice(0, 8).map((c) => (
              <span key={c.type} className="mr-3">
                {c.nameJp || c.name}: {c.quantity}
              </span>
            ))}
          </div>
        )}
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
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ background: '#eef3f8', zIndex: 10 }}>
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
