'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Upload,
  AlertTriangle,
  Box,
  RefreshCw,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePresence, usePresenceActions } from '@/lib/page-presence-context';
import { parseIfcToMeshes, type IfcMeshData } from '@/lib/ifc-loader';
import { createBimMaterialSet, getMaterialForElement } from '@/lib/ifc-bim-materials';
import { bimApi } from '@/lib/api/bim';

interface SceneStats {
  meshCount: number;
  byType: Record<string, number>;
  durationMs: number;
}

export default function BimViewerPage() {
  const { t } = useI18n();
  usePresence({ pageKey: 'bim/viewer', label: 'BIM Viewer: rendering IFC' });
  const presenceActions = usePresenceActions();

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneStateRef = useRef<{
    dispose: (() => void) | null;
    addMeshes: ((meshes: IfcMeshData[]) => void) | null;
    clearMeshes: (() => void) | null;
  }>({ dispose: null, addMeshes: null, clearMeshes: null });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  // Bootstrap the Three.js scene once.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — module exists at runtime, no .d.ts shipped under that path
        'three/examples/jsm/controls/OrbitControls.js'
      );
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeef2f7);

      const w = container.clientWidth;
      const h = Math.max(420, container.clientHeight);
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
      camera.position.set(40, 30, 60);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);

      const ambient = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambient);
      const hemi = new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 0.45);
      scene.add(hemi);
      const dir = new THREE.DirectionalLight(0xffffff, 1.0);
      dir.position.set(60, 80, 40);
      scene.add(dir);
      const fill = new THREE.DirectionalLight(0xd0d8e0, 0.35);
      fill.position.set(-60, 50, -30);
      scene.add(fill);

      const grid = new THREE.GridHelper(200, 40, 0xcfd8e3, 0xe2e8f0);
      grid.position.y = -0.02;
      scene.add(grid);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;

      const meshGroup = new THREE.Group();
      scene.add(meshGroup);

      const materialSet = createBimMaterialSet(THREE);

      const onResize = () => {
        const cw = container.clientWidth;
        const ch = Math.max(420, container.clientHeight);
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
        renderer.setSize(cw, ch);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(container);

      let frame = 0;
      const animate = () => {
        frame = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      sceneStateRef.current.addMeshes = (data: IfcMeshData[]) => {
        const bbox = new THREE.Box3();
        for (const md of data) {
          const geometry = new THREE.BufferGeometry();
          // Each vertex is 6 floats: x,y,z,nx,ny,nz (interleaved by ifc-loader).
          const stride = 6;
          const count = md.vertices.length / stride;
          const positions = new Float32Array(count * 3);
          const normals = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
            positions[i * 3] = md.vertices[i * stride];
            positions[i * 3 + 1] = md.vertices[i * stride + 1];
            positions[i * 3 + 2] = md.vertices[i * stride + 2];
            normals[i * 3] = md.vertices[i * stride + 3];
            normals[i * 3 + 1] = md.vertices[i * stride + 4];
            normals[i * 3 + 2] = md.vertices[i * stride + 5];
          }
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
          geometry.setIndex(new THREE.BufferAttribute(md.indices, 1));
          const mat = getMaterialForElement(materialSet, md.elementType, md.expressID);
          const mesh = new THREE.Mesh(geometry, mat);
          meshGroup.add(mesh);
          geometry.computeBoundingBox();
          if (geometry.boundingBox) bbox.union(geometry.boundingBox);
        }

        // Recenter and frame the model.
        if (!bbox.isEmpty()) {
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const center = new THREE.Vector3();
          bbox.getCenter(center);
          meshGroup.position.set(-center.x, -bbox.min.y, -center.z);
          const radius = Math.max(size.x, size.y, size.z) * 0.6;
          camera.position.set(radius * 1.6, radius * 1.0, radius * 1.6);
          controls.target.set(0, size.y * 0.4, 0);
          controls.update();
        }
      };

      sceneStateRef.current.clearMeshes = () => {
        while (meshGroup.children.length > 0) {
          const child = meshGroup.children[0];
          meshGroup.remove(child);
          if ((child as any).geometry) (child as any).geometry.dispose();
        }
      };

      sceneStateRef.current.dispose = () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        try {
          renderer.dispose();
        } catch {
          // ignore
        }
        if (renderer.domElement.parentElement) {
          renderer.domElement.parentElement.removeChild(renderer.domElement);
        }
      };

      cleanup = () => sceneStateRef.current.dispose?.();
    })().catch((err) => {
      if (cancelled) return;
      setError((err as Error)?.message || 'Failed to initialise 3D scene');
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'ifc') {
        setError(t('bimViewer', 'unsupportedFormat'));
        return;
      }
      setError(null);
      setBusy(true);
      const start = performance.now();
      try {
        const buffer = await file.arrayBuffer();
        const meshes = await parseIfcToMeshes(buffer);
        sceneStateRef.current.clearMeshes?.();
        sceneStateRef.current.addMeshes?.(meshes);
        const byType: Record<string, number> = {};
        for (const m of meshes) {
          byType[m.elementType] = (byType[m.elementType] ?? 0) + 1;
        }
        const durationMs = Math.round(performance.now() - start);
        setStats({ meshCount: meshes.length, byType, durationMs });
        setFilename(file.name);

        // Mirror to the upload feed (best-effort).
        bimApi
          .trackUpload({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            metadata: { meshCount: meshes.length, byType, durationMs },
          })
          .catch(() => undefined);

        presenceActions.recordAction(`Rendered IFC "${file.name}" (${meshes.length} meshes)`);
      } catch (err) {
        setError((err as Error)?.message || t('bimViewer', 'parseFailed'));
      } finally {
        setBusy(false);
      }
    },
    [presenceActions, t],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <Link
            href="/bim"
            className="inline-flex items-center gap-1.5 text-sm text-violet-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('bimViewer', 'back')}
          </Link>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ifc"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            <button
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 text-sm"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t('bimViewer', 'openIfc')}
            </button>
            <button
              onClick={() => {
                sceneStateRef.current.clearMeshes?.();
                setStats(null);
                setFilename(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              {t('bimViewer', 'clear')}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Box className="h-5 w-5 text-violet-600" />
              {t('bimViewer', 'title')}
            </h1>
            {filename && (
              <span className="text-xs text-gray-500 font-mono truncate max-w-[60%]" title={filename}>
                {filename}
              </span>
            )}
          </div>
          <div
            ref={containerRef}
            className="w-full"
            style={{ height: '70vh', minHeight: 480 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          {!stats && !busy && (
            <div className="absolute pointer-events-none inset-0 flex items-center justify-center">
              {/* Visual hint sits above the canvas via the parent's relative-zero, kept inside the same card */}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {stats && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              {t('bimViewer', 'statsTitle')}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="px-2 py-1 rounded bg-violet-50 text-violet-700 border border-violet-200">
                {t('bimViewer', 'meshCount')}: {stats.meshCount}
              </span>
              <span className="px-2 py-1 rounded bg-gray-50 text-gray-700 border border-gray-200">
                {t('bimViewer', 'parseDuration')}: {stats.durationMs} ms
              </span>
              {Object.entries(stats.byType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <span
                    key={type}
                    className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {type}: {count}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
