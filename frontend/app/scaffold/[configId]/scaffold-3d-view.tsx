'use client';

import { useRef, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, FileText, FileCode, Box, Download } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { WallCalculationResult } from '@/lib/api/scaffold-configs';
import { scaffoldConfigsApi } from '@/lib/api/scaffold-configs';
import html2canvas from 'html2canvas';

/**
 * 3D Scaffold View — Arbitrary Polygon Layout
 * Walls are arranged around a building perimeter computed from wall lengths.
 * Supports any number of walls (not just N/S/E/W).
 */

const PIPE_R = 0.024;
const PIPE_SEG = 10;
const LEVEL_H_KUSABI = 1.8;
const JACK_H = 0.3;
const NEGR_H = 0.2;
type ViewMode = 'all' | 'wall';

// High-visibility scaffold palette
const C = {
  pipe:       0xdbe5f0,
  pipeDark:   0x9fb3c8,
  plank:      0xfbbf24,
  plankEdge:  0xd97706,
  jackBase:   0x7c8ea3,
  basePlate:  0x8fa3b9,
  stair:      0x60a5fa,
  stairRail:  0x3b82f6,
  habaki:     0xf59e0b,
  pattanko:   0xd97706,  // パッタンコ — small filler plank at corners
  frame:      0xb0c4de,
  frameDark:  0x7a93af,
  ground:     0xf8fafc,
  bg:         0xeef3f8,
  grid:       0xd9e3ef,
  ambient:    0xffffff,
  dirLight:   0xffffff,
};

// Per-wall accent colors
const WALL_COLORS_HEX = [
  0x3b82f6, 0xf59e0b, 0x10b981, 0xec4899,
  0x8b5cf6, 0xef4444, 0x06b6d4, 0x84cc16,
  0xf97316, 0x6366f1,
];

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
    if (spread < 1e-6) return []; // degenerate

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

export default function Scaffold3DView({ result }: { result: any }) {
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
  const wallObjectsRef = useRef<Array<{ root: any; label: any; edge: any }>>([]);
  const wallFocusRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  const clickTargetsRef = useRef<any[]>([]);
  const controlsRef = useRef<any>(null);

  const walls: WallCalculationResult[] = result?.walls ?? [];

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

    import('three').then((THREE) => {
      if (disposed || !canvasContainerRef.current) return;

      while (canvasContainer.firstChild) {
        canvasContainer.removeChild(canvasContainer.firstChild);
      }

      const w = canvasContainer.clientWidth;
      const h = canvasContainer.clientHeight;

      // ── Scene ──────────────────────────────────────────
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(C.bg);
      scene.fog = new THREE.Fog(C.bg, 140, 320);
      sceneRef.current = scene;
      wallObjectsRef.current = [];
      wallFocusRef.current = [];
      clickTargetsRef.current = [];

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
      renderer.toneMappingExposure = 1.2;
      if ('outputColorSpace' in renderer) {
        (renderer as any).outputColorSpace = THREE.SRGBColorSpace;
      }
      canvasElement = renderer.domElement;
      canvasContainer.appendChild(canvasElement as unknown as Node);

      // ── Lights ─────────────────────────────────────────
      const ambientLight = new THREE.AmbientLight(C.ambient, 1.15);
      scene.add(ambientLight);

      const hemiLight = new THREE.HemisphereLight(0xffffff, 0xdbeafe, 0.65);
      scene.add(hemiLight);

      const dirLight = new THREE.DirectionalLight(C.dirLight, 1.25);
      dirLight.position.set(15, 20, 10);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      scene.add(dirLight);

      const fillLight = new THREE.DirectionalLight(0xffffff, 0.75);
      fillLight.position.set(-12, 10, -8);
      scene.add(fillLight);

      // ── Shared materials ───────────────────────────────
      const pipeMat = new THREE.MeshStandardMaterial({ color: C.pipe, metalness: 0.6, roughness: 0.35 });
      const pipeDarkMat = new THREE.MeshStandardMaterial({ color: C.pipeDark, metalness: 0.5, roughness: 0.4 });
      const plankMat = new THREE.MeshStandardMaterial({ color: C.plank, metalness: 0.3, roughness: 0.6 });
      const jackMat = new THREE.MeshStandardMaterial({ color: C.jackBase, metalness: 0.7, roughness: 0.3 });
      const habakiMat = new THREE.MeshStandardMaterial({ color: C.habaki, metalness: 0.4, roughness: 0.5 });
      const pattankoMat = new THREE.MeshStandardMaterial({ color: C.pattanko, metalness: 0.25, roughness: 0.65 });
      const stairMat = new THREE.MeshStandardMaterial({ color: C.stair, metalness: 0.3, roughness: 0.5 });
      const groundMat = new THREE.MeshStandardMaterial({ color: C.ground, metalness: 0, roughness: 0.95 });
      const frameMat = new THREE.MeshStandardMaterial({ color: C.frame, metalness: 0.55, roughness: 0.3 });
      const frameDarkMat = new THREE.MeshStandardMaterial({ color: C.frameDark, metalness: 0.5, roughness: 0.35 });

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

      /** パッタンコ (PATTANKO): small filler plank bridging a gap in the XZ plane at height y. */
      function addPattanko(
        parent: THREE.Object3D,
        ax: number, az: number,
        bx: number, bz: number,
        y: number,
        mat: THREE.MeshStandardMaterial,
      ) {
        const gap = Math.hypot(bx - ax, bz - az);
        if (gap < 0.02) return;
        const midX = (ax + bx) / 2;
        const midZ = (az + bz) / 2;
        const thickness = 0.03;
        const width = Math.min(0.25, gap * 0.8);
        const geo = new THREE.BoxGeometry(gap, thickness, width);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(midX, y, midZ);
        mesh.rotation.y = Math.atan2(bz - az, bx - ax);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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

      /**
       * Adds a multi-line label sprite showing wall name, length, and height.
       */
      function addWallLabel(
        parent: THREE.Object3D,
        name: string,
        lengthMm: number,
        heightMm: number,
        levels: number,
        x: number, y: number, z: number,
        color: string,
      ): THREE.Sprite | null {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        canvas.width = 1024;
        canvas.height = 512;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background pill
        const bgW = 900, bgH = 380;
        const bgX = (canvas.width - bgW) / 2, bgY = (canvas.height - bgH) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.beginPath();
        ctx.roundRect(bgX, bgY, bgW, bgH, 30);
        ctx.fill();

        // Wall name
        ctx.font = 'bold 72px Arial';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, canvas.width / 2, canvas.height / 2 - 110);

        // Length line
        ctx.font = '52px Arial';
        ctx.fillStyle = '#ffffff';
        const lenM = (lengthMm / 1000).toFixed(1);
        ctx.fillText(`L: ${lenM}m (${lengthMm.toLocaleString()}mm)`, canvas.width / 2, canvas.height / 2 - 20);

        // Height line
        ctx.font = '48px Arial';
        ctx.fillStyle = '#d1d5db';
        const htM = (heightMm / 1000).toFixed(1);
        ctx.fillText(`H: ${htM}m  ×${levels}lvl`, canvas.width / 2, canvas.height / 2 + 70);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;

        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const spr = new THREE.Sprite(mat);
        spr.position.set(x, y, z);
        spr.scale.set(5, 2.5, 1);
        parent.add(spr);
        return spr;
      }

      // ══════════════════════════════════════════════════════
      // BUILD SCAFFOLD FOR ONE WALL (local coordinates: along X axis, depth along Z)
      // ══════════════════════════════════════════════════════
      function buildWallScaffold(wall: WallCalculationResult, group: THREE.Group, maxSpans?: number) {
        const allSpans: number[] = wall.spans;
        // If capped, take only the first N spans (representative section)
        const spans = maxSpans != null && maxSpans < allSpans.length
          ? allSpans.slice(0, maxSpans)
          : allSpans;
        const postX: number[] = [0];
        let acc = 0;
        for (const s of spans) { acc += s / 1000; postX.push(acc); }
        const totalLen = postX[postX.length - 1] || 0;
        const levels = wall.levelCalc.fullLevels;
        const totalPostH = levels * LEVEL_H + topGuardM;

        const kaidanSpanIndices = wall.kaidanSpanIndices || [];

        // ── Jack bases + base plates ───────────────────
        for (const px of postX) {
          for (const pz of [0, widthM]) {
            addBox(group, px, 0.005, pz, 0.15, 0.01, 0.15, jackMat);
            addPipe(group, px, 0.01, pz, px, JACK_H, pz, jackMat, PIPE_R * 0.7);
            const colGeo = new THREE.CylinderGeometry(PIPE_R * 1.8, PIPE_R * 1.8, 0.04, 12);
            const colMesh = new THREE.Mesh(colGeo, jackMat);
            colMesh.position.set(px, JACK_H, pz);
            group.add(colMesh);
          }
        }

        // ── Vertical posts / frames ──────────────────
        if (isWakugumi) {
          // Wakugumi: render portal frames (建枠) at each post position per level
          for (const px of postX) {
            for (let lv = 0; lv < levels; lv++) {
              const frameBaseY = JACK_H + lv * LEVEL_H;
              addWakugumiFrame(group, px, frameBaseY, LEVEL_H, widthM);
            }
          }
        } else {
          // Kusabi: individual vertical pipes
          for (const px of postX) {
            for (const pz of [0, widthM]) {
              addPipe(group, px, JACK_H, pz, px, JACK_H + totalPostH, pz, pipeMat);
              for (let lv = 0; lv <= levels; lv++) {
                addJoint(group, px, JACK_H + lv * LEVEL_H, pz);
              }
              addJoint(group, px, JACK_H + totalPostH, pz);
            }
          }
        }

        // ── 根がらみ (Base yokoji) ─────────────────────
        const baseY = JACK_H + NEGR_H;
        for (let i = 0; i < spans.length; i++) {
          const x1 = postX[i];
          const x2 = postX[i + 1];
          for (const pz of [0, widthM]) {
            addPipe(group, x1, baseY, pz, x2, baseY, pz, pipeDarkMat);
          }
        }
        for (const px of postX) {
          addPipe(group, px, baseY, 0, px, baseY, widthM, pipeDarkMat);
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
        for (let lv = 1; lv <= levels; lv++) {
          const y = JACK_H + lv * LEVEL_H;

          // Width yokoji
          for (const px of postX) {
            addPipe(group, px, y, 0, px, y, widthM, pipeDarkMat, PIPE_R * 0.9);
          }

          for (let i = 0; i < spans.length; i++) {
            const x1 = postX[i];
            const x2 = postX[i + 1];
            const spanM = spans[i] / 1000;
            const midX = (x1 + x2) / 2;
            const baseYLv = JACK_H + (lv - 1) * LEVEL_H;
            const isStairSpan = uniqueStairPos.includes(i);

            if (isWakugumi) {
              // ── Wakugumi: Brace on BOTH faces ──
              // OUTER face — X-Brace (z = 0)
              addPipe(group, x1, baseYLv, 0, x2, y, 0, pipeDarkMat, PIPE_R * 0.7);
              addPipe(group, x1, y, 0, x2, baseYLv, 0, pipeDarkMat, PIPE_R * 0.7);
              // INNER face — X-Brace (z = widthM)
              addPipe(group, x1, baseYLv, widthM, x2, y, widthM, pipeDarkMat, PIPE_R * 0.7);
              addPipe(group, x1, y, widthM, x2, baseYLv, widthM, pipeDarkMat, PIPE_R * 0.7);

              // 下桟 (Shitasan) — bottom horizontal, both faces
              const shitasanY = baseYLv + 0.05;
              addPipe(group, x1, shitasanY, 0, x2, shitasanY, 0, pipeMat, PIPE_R * 0.8);
              addPipe(group, x1, shitasanY, widthM, x2, shitasanY, widthM, pipeMat, PIPE_R * 0.8);
            } else {
              // ── Kusabi: Brace on OUTER face only ──
              // OUTER face — X-Brace (z = 0)
              addPipe(group, x1, baseYLv, 0, x2, y, 0, pipeDarkMat, PIPE_R * 0.7);
              addPipe(group, x1, y, 0, x2, baseYLv, 0, pipeDarkMat, PIPE_R * 0.7);

              // INNER face — Tesuri/Nuno (z = widthM)
              const tesuriY1 = baseYLv + LEVEL_H * 0.5;
              const tesuriY2 = y;
              addPipe(group, x1, tesuriY1, widthM, x2, tesuriY1, widthM, pipeMat);
              addPipe(group, x1, tesuriY2, widthM, x2, tesuriY2, widthM, pipeMat);
            }

            // Plank / Anchi (skip stair spans)
            if (!isStairSpan) {
              addBox(group, midX, y + 0.015, widthM / 2, spanM - 0.04, 0.03, widthM * 0.9, plankMat);
              addBox(group, midX, y + 0.015, widthM * 0.05, spanM - 0.04, 0.035, 0.02, habakiMat);
              addBox(group, midX, y + 0.015, widthM * 0.95, spanM - 0.04, 0.035, 0.02, habakiMat);
            }

            // Habaki / Toe boards
            addBox(group, midX, y + 0.06, 0, spanM - 0.04, 0.1, 0.015, habakiMat);
            addBox(group, midX, y + 0.06, widthM, spanM - 0.04, 0.1, 0.015, habakiMat);
          }
        }

        // ── Top guard rails ────────────────────────────
        const topH = JACK_H + levels * LEVEL_H;
        const guardH = topH + topGuardM;
        for (let i = 0; i < spans.length; i++) {
          const x1 = postX[i];
          const x2 = postX[i + 1];
          for (const pz of [0, widthM]) {
            addPipe(group, x1, guardH, pz, x2, guardH, pz, pipeMat);
            addPipe(group, x1, topH + topGuardM * 0.5, pz, x2, topH + topGuardM * 0.5, pz, pipeMat);
          }
        }

        // ── Stairs ─────────────────────────────────────
        const RAIL_H_ABOVE = 0.9;
        const NUM_STEPS = 8;

        for (let lv = 1; lv <= levels; lv++) {
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
        buildWallScaffold(wall, group, spanCaps[i]);

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
        const totalH = JACK_H + levels * LEVEL_H + topGuardM;
        if (totalH > maxH) maxH = totalH;

        const dist = Math.hypot(v1.x - cx, v1.z - cz);
        if (dist + widthM > maxExtent) maxExtent = dist + widthM;

        // Wall label — shows name, length (m + mm), height (m), levels
        const labelMidX = (v1.x + v2.x) / 2 - cx + nx * (widthM + 2.0);
        const labelMidZ = (v1.z + v2.z) / 2 - cz + nz * (widthM + 2.0);
        const colorHex = '#' + WALL_COLORS_HEX[i % WALL_COLORS_HEX.length].toString(16).padStart(6, '0');
        const labelSprite = addWallLabel(
          scene,
          wall.sideJp,
          wall.wallLengthMm,
          wall.levelCalc.totalScaffoldHeightMm,
          levels,
          labelMidX, totalH * 0.5, labelMidZ,
          colorHex,
        );

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

        // Invisible hit area to allow clicking each wall segment
        const clickGeo = new THREE.BoxGeometry(edgeLen, Math.max(totalH, 2), Math.max(widthM * 0.35, 0.35));
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
          label: labelSprite,
          edge: edgeLine,
        });
        wallFocusRef.current.push({
          x: (v1.x + v2.x) / 2 - cx + nx * (widthM * 1.6),
          y: Math.max(totalH * 0.45, 2.2),
          z: (v1.z + v2.z) / 2 - cz + nz * (widthM * 1.6),
        });
        clickTargetsRef.current.push(clickMesh);
      }

      // ── Corner connectors — bridge the gap between adjacent wall scaffolds ──
      for (let j = 0; j < walls.length; j++) {
        const prevIdx = (j - 1 + walls.length) % walls.length;
        const nPrev = wallNormals[prevIdx];
        const nCurr = wallNormals[j];
        if ((nPrev.nx === 0 && nPrev.nz === 0) || (nCurr.nx === 0 && nCurr.nz === 0)) continue;

        const vx = verts[j].x - cx;
        const vz = verts[j].z - cz;

        // Two scaffold post rows at this corner for the previous wall (end) and current wall (start)
        const prevR0 = { x: vx + nPrev.nx * widthM, z: vz + nPrev.nz * widthM };
        const prevR1 = { x: vx + nPrev.nx * 2 * widthM, z: vz + nPrev.nz * 2 * widthM };
        const currR0 = { x: vx + nCurr.nx * widthM, z: vz + nCurr.nz * widthM };
        const currR1 = { x: vx + nCurr.nx * 2 * widthM, z: vz + nCurr.nz * 2 * widthM };

        const gapR0 = Math.hypot(prevR0.x - currR0.x, prevR0.z - currR0.z);
        const gapR1 = Math.hypot(prevR1.x - currR1.x, prevR1.z - currR1.z);
        if (gapR0 < 0.01 && gapR1 < 0.01) continue;

        const prevLevels = walls[prevIdx].levelCalc.fullLevels;
        const currLevels = walls[j].levelCalc.fullLevels;
        const cornerLevels = Math.max(prevLevels, currLevels);
        const cornerH = JACK_H + cornerLevels * LEVEL_H + topGuardM;

        // Vertical corner posts (full height) at each of the 4 positions
        for (const p of [prevR0, prevR1, currR0, currR1]) {
          addPipe(scene, p.x, JACK_H, p.z, p.x, cornerH, p.z, pipeMat, PIPE_R * 0.9);
        }

        // Horizontal connecting pipes at each level + base + guard
        const heights = [JACK_H + NEGR_H];
        for (let lv = 1; lv <= cornerLevels; lv++) heights.push(JACK_H + lv * LEVEL_H);
        heights.push(cornerH);
        heights.push(JACK_H + cornerLevels * LEVEL_H + topGuardM * 0.5);

        for (const y of heights) {
          if (gapR0 >= 0.01) addPipe(scene, prevR0.x, y, prevR0.z, currR0.x, y, currR0.z, pipeDarkMat, PIPE_R * 0.8);
          if (gapR1 >= 0.01) addPipe(scene, prevR1.x, y, prevR1.z, currR1.x, y, currR1.z, pipeDarkMat, PIPE_R * 0.8);
        }

        // パッタンコ (PATTANKO): small filler planks at each level so the corner is not empty
        for (let lv = 1; lv <= cornerLevels; lv++) {
          const plankY = JACK_H + lv * LEVEL_H + 0.015;
          if (gapR0 >= 0.02) addPattanko(scene, prevR0.x, prevR0.z, currR0.x, currR0.z, plankY, pattankoMat);
          if (gapR1 >= 0.02) addPattanko(scene, prevR1.x, prevR1.z, currR1.x, currR1.z, plankY, pattankoMat);
        }
      }

      // ── Building outline at ground level ─────────────
      const outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
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

      // Building label
      {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = 512;
          canvas.height = 256;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.font = 'bold 64px Arial';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(t('viewer', 'building'), canvas.width / 2, canvas.height / 2);

          const tex = new THREE.CanvasTexture(canvas);
          tex.minFilter = THREE.LinearFilter;
          const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
          const spr = new THREE.Sprite(mat);
          spr.position.set(0, 0.5, 0);
          spr.scale.set(3.5, 1.75, 1);
          scene.add(spr);
        }
      }

      // ── Ground plane ─────────────────────────────────
      const groundSize = Math.max(maxExtent * 4 + 20, 100);
      const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
      const groundPlane = new THREE.Mesh(groundGeo, groundMat);
      groundPlane.rotation.x = -Math.PI / 2;
      groundPlane.position.y = -0.03;
      groundPlane.receiveShadow = true;
      scene.add(groundPlane);

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
        if (!hits.length) return;
        const wallIndex = hits[0].object?.userData?.wallIndex;
        if (!Number.isInteger(wallIndex)) return;
        setViewMode('wall');
        setActiveWallIdx(wallIndex);
        applyWallVisibility('wall', wallIndex);
        focusCameraOnWall(wallIndex);
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
  }, [walls, result?.scaffoldWidthMm, result?.topGuardHeightMm, result?.polygonVertices, t]);

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
