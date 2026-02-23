'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { PerimeterModel, PerimeterSegment, PerimeterPoint } from '@/lib/perimeter-model';

/**
 * ═══════════════════════════════════════════════════════════
 * Scaffold Renderer 3D — Read-Only Visualization
 * ═══════════════════════════════════════════════════════════
 *
 * Reads perimeterModel data (one-way dependency: Model → Renderer).
 * For each segment:
 *   - Divides by span length
 *   - Generates vertical posts (CylinderGeometry)
 *   - Generates horizontal bars (BoxGeometry)
 *
 * NEVER modifies perimeterModel.
 */

interface ScaffoldRenderer3DProps {
  model: PerimeterModel;
  /** Building height in mm */
  buildingHeightMm: number;
  /** Scaffold width in mm (450, 600, 900, 1200) */
  scaffoldWidthMm?: number;
  /** Level height in mm (always 1800) */
  levelHeightMm?: number;
  /** Preferred span length in mm */
  preferredSpanMm?: number;
  width?: number;
  height?: number;
}

// ── Scaffold constants ───────────────────────────────────

const POST_DIAMETER = 48.6; // mm (φ48.6)
const POST_RADIUS = POST_DIAMETER / 2;
const YOKOJI_HEIGHT = 30; // mm cross-section
const YOKOJI_DEPTH = 30; // mm cross-section
const AVAILABLE_SPANS = [600, 900, 1200, 1500, 1800]; // mm

// ── Colors ───────────────────────────────────────────────

const POST_COLOR = 0x666666; // Gray steel
const YOKOJI_COLOR = 0x888888; // Lighter gray
const BRACE_COLOR = 0xcc8833; // Orange/brown
const PLANK_COLOR = 0xb8860b; // Dark goldenrod (wood)
const GROUND_COLOR = 0xc5c5a0; // Khaki ground

const SCALE = 0.001; // mm → Three.js units (1 unit = 1m)

export function ScaffoldRenderer3D({
  model,
  buildingHeightMm,
  scaffoldWidthMm = 900,
  levelHeightMm = 1800,
  preferredSpanMm = 1800,
  width = 800,
  height = 600,
}: ScaffoldRenderer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const scaffoldGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);

  const [isGenerating, setIsGenerating] = useState(false);

  // ── Initialize Three.js ──────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    scene.fog = new THREE.Fog(0xf0f0f0, 50, 200);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(20, 15, 20);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI * 0.85;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 15);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    scene.add(dirLight);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshLambertMaterial({ color: GROUND_COLOR });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid helper
    const gridHelper = new THREE.GridHelper(100, 100, 0x888888, 0xcccccc);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Render loop
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      controls.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentElement === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [width, height]);

  // ── Generate scaffold from model data ────────────────────

  const generateScaffold = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous scaffold
    if (scaffoldGroupRef.current) {
      scene.remove(scaffoldGroupRef.current);
      scaffoldGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }

    const segments = model.getSegments();
    const points = model.getPoints();

    if (segments.length === 0 || !model.isClosed) {
      scaffoldGroupRef.current = null;
      return;
    }

    setIsGenerating(true);

    const scaffoldGroup = new THREE.Group();

    const levels = Math.max(1, Math.ceil(buildingHeightMm / levelHeightMm));
    const widthS = scaffoldWidthMm * SCALE;
    const levelH = levelHeightMm * SCALE;

    // Shared materials
    const postMat = new THREE.MeshLambertMaterial({ color: POST_COLOR });
    const yokojiMat = new THREE.MeshLambertMaterial({ color: YOKOJI_COLOR });
    const braceMat = new THREE.MeshLambertMaterial({ color: BRACE_COLOR });
    const plankMat = new THREE.MeshLambertMaterial({ color: PLANK_COLOR });

    // For each wall segment, build scaffold along it
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx];
      const startPt = points[seg.startIndex];
      const endPt = points[seg.endIndex];

      // Wall direction vector
      const dx = endPt.x - startPt.x;
      const dy = endPt.y - startPt.y;
      const wallLength = seg.length;
      const wallLengthS = wallLength * SCALE;

      // Normalized direction
      const dirX = dx / wallLength;
      const dirY = dy / wallLength;

      // Normal vector (outward from building) — assume CCW polygon
      const normX = -dirY;
      const normY = dirX;

      // Determine spans
      const spans = computeSpans(wallLength, preferredSpanMm);

      // Start position (in Three.js coords: x=CAD_x, z=-CAD_y, y=up)
      const sx = startPt.x * SCALE;
      const sz = -startPt.y * SCALE;
      const ndx = dirX;
      const ndz = -dirY;
      const nnx = normX;
      const nnz = -normY;

      let accumulatedLength = 0;

      // Generate posts at each post position
      for (let spanIdx = 0; spanIdx <= spans.length; spanIdx++) {
        const posAlong = accumulatedLength * SCALE;

        // Post position (inner and outer row)
        for (let row = 0; row < 2; row++) {
          const offsetDist = row === 0 ? 0 : widthS;

          const px = sx + ndx * posAlong + nnx * offsetDist;
          const pz = sz + ndz * posAlong + nnz * offsetDist;

          // Vertical posts for all levels
          for (let level = 0; level < levels; level++) {
            const py = level * levelH;
            const postHeight = levelH;

            const postGeo = new THREE.CylinderGeometry(
              POST_RADIUS * SCALE,
              POST_RADIUS * SCALE,
              postHeight,
              8,
            );
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.set(px, py + postHeight / 2, pz);
            post.castShadow = true;
            scaffoldGroup.add(post);
          }

          // Jack base at bottom
          const baseGeo = new THREE.CylinderGeometry(
            POST_RADIUS * SCALE * 2,
            POST_RADIUS * SCALE * 3,
            0.05,
            8,
          );
          const base = new THREE.Mesh(baseGeo, yokojiMat);
          base.position.set(px, 0.025, pz);
          scaffoldGroup.add(base);
        }

        if (spanIdx < spans.length) {
          accumulatedLength += spans[spanIdx];
        }
      }

      // Generate horizontal bars (yokoji) along span direction for each level
      accumulatedLength = 0;
      for (let spanIdx = 0; spanIdx < spans.length; spanIdx++) {
        const spanLen = spans[spanIdx];
        const spanLenS = spanLen * SCALE;
        const spanMid = (accumulatedLength + spanLen / 2) * SCALE;

        for (let level = 0; level <= levels; level++) {
          const py = level * levelH;

          // Inner and outer horizontal bars
          for (let row = 0; row < 2; row++) {
            const offsetDist = row === 0 ? 0 : widthS;

            const hx = sx + ndx * spanMid + nnx * offsetDist;
            const hz = sz + ndz * spanMid + nnz * offsetDist;

            const barGeo = new THREE.BoxGeometry(
              spanLenS,
              YOKOJI_HEIGHT * SCALE,
              YOKOJI_DEPTH * SCALE,
            );
            const bar = new THREE.Mesh(barGeo, yokojiMat);

            // Rotate bar to align with wall direction
            const angle = Math.atan2(ndz, ndx);
            bar.rotation.y = -angle;
            bar.position.set(hx, py, hz);
            scaffoldGroup.add(bar);
          }

          // Width-direction yokoji (connecting inner and outer rows)
          if (level > 0 || level === 0) {
            // At each post position
            const posAlong1 = accumulatedLength * SCALE;
            const posAlong2 = (accumulatedLength + spanLen) * SCALE;

            for (const posAlong of [posAlong1, posAlong2]) {
              const wx = sx + ndx * posAlong + nnx * (widthS / 2);
              const wz = sz + ndz * posAlong + nnz * (widthS / 2);

              const widthBarGeo = new THREE.BoxGeometry(
                YOKOJI_DEPTH * SCALE,
                YOKOJI_HEIGHT * SCALE,
                widthS,
              );
              const widthBar = new THREE.Mesh(widthBarGeo, yokojiMat);
              const angle = Math.atan2(nnz, nnx);
              widthBar.rotation.y = -angle;
              widthBar.position.set(wx, py, wz);
              scaffoldGroup.add(widthBar);
            }
          }

          // Plank (between rows, at each level above ground)
          if (level > 0) {
            const plankX = sx + ndx * spanMid + nnx * (widthS / 2);
            const plankZ = sz + ndz * spanMid + nnz * (widthS / 2);

            const plankGeo = new THREE.BoxGeometry(
              spanLenS,
              0.02,
              widthS * 0.9,
            );
            const plank = new THREE.Mesh(plankGeo, plankMat);
            const angle = Math.atan2(ndz, ndx);
            plank.rotation.y = -angle;
            plank.position.set(plankX, py + 0.01, plankZ);
            scaffoldGroup.add(plank);
          }
        }

        // X-brace on outer face (for each level)
        for (let level = 0; level < levels; level++) {
          const py = level * levelH;
          const braceStart = accumulatedLength * SCALE;
          const braceEnd = (accumulatedLength + spanLen) * SCALE;

          // Diagonal brace (simplified as a thin box)
          const bx1 = sx + ndx * braceStart + nnx * widthS;
          const bz1 = sz + ndz * braceStart + nnz * widthS;
          const bx2 = sx + ndx * braceEnd + nnx * widthS;
          const bz2 = sz + ndz * braceEnd + nnz * widthS;

          const braceLen = Math.hypot(bx2 - bx1, levelH, bz2 - bz1);
          const braceMidX = (bx1 + bx2) / 2;
          const braceMidZ = (bz1 + bz2) / 2;

          const braceGeo = new THREE.CylinderGeometry(
            POST_RADIUS * SCALE * 0.5,
            POST_RADIUS * SCALE * 0.5,
            braceLen,
            4,
          );
          const brace = new THREE.Mesh(braceGeo, braceMat);

          // Position at center of brace
          brace.position.set(braceMidX, py + levelH / 2, braceMidZ);

          // Rotate to align with diagonal
          const wallAngle = Math.atan2(ndz, ndx);
          const tiltAngle = Math.atan2(levelH, spanLenS);
          brace.rotation.y = -wallAngle;
          brace.rotation.z = tiltAngle;

          scaffoldGroup.add(brace);
        }

        accumulatedLength += spanLen;
      }
    }

    scene.add(scaffoldGroup);
    scaffoldGroupRef.current = scaffoldGroup;

    // Fit camera to scaffold
    const box = new THREE.Box3().setFromObject(scaffoldGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(
        center.x + maxDim * 1.2,
        center.y + maxDim * 0.8,
        center.z + maxDim * 1.2,
      );
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }

    setIsGenerating(false);
  }, [model, buildingHeightMm, scaffoldWidthMm, levelHeightMm, preferredSpanMm]);

  // ── Regenerate on model change ───────────────────────────

  useEffect(() => {
    if (model.isClosed && model.segmentCount >= 3) {
      generateScaffold();
    }

    const unsubscribe = model.onChange(() => {
      if (model.isClosed && model.segmentCount >= 3) {
        generateScaffold();
      }
    });

    return unsubscribe;
  }, [model, generateScaffold]);

  return (
    <div className="relative" style={{ width, height }}>
      <div ref={containerRef} style={{ width, height }} />

      {isGenerating && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50">
          <div className="text-sm text-gray-600 animate-pulse">Generating scaffold...</div>
        </div>
      )}

      {!model.isClosed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900/70 text-white text-sm px-4 py-2 rounded-lg">
            Close the polygon in the 2D editor to generate scaffold
          </div>
        </div>
      )}

      {/* Info overlay */}
      <div className="absolute top-2 left-2 bg-white/90 rounded px-2 py-1 text-xs text-gray-600 shadow-sm">
        <div>Walls: {model.segmentCount}</div>
        <div>Height: {(buildingHeightMm / 1000).toFixed(1)}m</div>
        <div>Levels: {Math.max(1, Math.ceil(buildingHeightMm / levelHeightMm))}</div>
        <div>Width: {scaffoldWidthMm}mm</div>
      </div>
    </div>
  );
}

// ── Span computation helper ──────────────────────────────

function computeSpans(wallLengthMm: number, preferredSpanMm: number): number[] {
  if (wallLengthMm <= 0) return [];

  // Find the best span size
  const spanOptions = AVAILABLE_SPANS.filter(s => s <= preferredSpanMm);
  if (spanOptions.length === 0) spanOptions.push(AVAILABLE_SPANS[0]);

  const bestSpan = spanOptions[spanOptions.length - 1]; // Largest <= preferred

  const numSpans = Math.max(1, Math.floor(wallLengthMm / bestSpan));
  const remainder = wallLengthMm - numSpans * bestSpan;

  const spans: number[] = [];

  if (remainder < 100) {
    // Remainder too small, distribute evenly
    const evenSpan = wallLengthMm / numSpans;
    // Find closest standard span
    const closest = AVAILABLE_SPANS.reduce((best, s) =>
      Math.abs(s - evenSpan) < Math.abs(best - evenSpan) ? s : best,
    );
    for (let i = 0; i < numSpans; i++) {
      spans.push(closest);
    }
  } else {
    // Use full spans + remainder
    for (let i = 0; i < numSpans; i++) {
      spans.push(bestSpan);
    }
    // Find closest standard span for remainder
    const closestRemainder = AVAILABLE_SPANS.reduce((best, s) =>
      Math.abs(s - remainder) < Math.abs(best - remainder) ? s : best,
    );
    spans.push(closestRemainder);
  }

  return spans;
}
