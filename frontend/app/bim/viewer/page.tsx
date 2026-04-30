'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Upload,
  AlertTriangle,
  Box,
  RefreshCw,
  Cloud,
  CheckCircle2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { usePresence, usePresenceActions } from '@/lib/page-presence-context';
import { parseIfcToMeshes, type IfcMeshData } from '@/lib/ifc-loader';
import { createBimMaterialSet, getMaterialForElement } from '@/lib/ifc-bim-materials';
import { buildBimFromDxf } from '@/lib/bim/dxf-procedural-bim';
import { renderPdfPageToPlane } from '@/lib/bim/pdf-reference-plane';
import { mimeTypeForRasterExtension, renderRasterImageToPlane } from '@/lib/bim/image-reference-plane';
import { bimApi } from '@/lib/api/bim';
import { accessApi } from '@/lib/api/access';
import { authApi } from '@/lib/api/auth';

interface SceneStats {
  meshCount: number;
  byType: Record<string, number>;
  durationMs: number;
  referenceOnly?: boolean;
}

function isRasterExtension(ext: string | undefined): boolean {
  if (!ext) return false;
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext.toLowerCase());
}

function BimViewerPageInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  usePresence({ pageKey: 'bim/viewer', label: 'BIM Viewer: rendering IFC' });
  const presenceActions = usePresenceActions();

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  /** Clone of last dropped PDF bytes so the user can switch pages without re-reading the file input. */
  const lastPdfBufferRef = useRef<ArrayBuffer | null>(null);
  const lastPdfFilenameRef = useRef<string | null>(null);
  const loadedRemoteModelIdRef = useRef<string | null>(null);
  const sceneStateRef = useRef<{
    dispose: (() => void) | null;
    addMeshes: ((meshes: IfcMeshData[]) => void) | null;
    addReferencePlane:
      | ((canvas: HTMLCanvasElement, worldWidth: number, worldDepth: number) => void)
      | null;
    clearMeshes: (() => void) | null;
  }>({
    dispose: null,
    addMeshes: null,
    addReferencePlane: null,
    clearMeshes: null,
  });

  const [sceneReady, setSceneReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNumPages, setPdfNumPages] = useState(0);

  const hasToken = !!authApi.getToken();
  const accessQuery = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    enabled: hasToken,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!hasToken) {
      const next = `/bim/viewer${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [hasToken, router, searchParams]);

  const saveToCloud = useMutation({
    mutationFn: (payload: { file: File; displayName?: string }) =>
      bimApi.uploadModel(payload.file, { displayName: payload.displayName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bim-models'] });
      setInfo(t('bimViewer', 'savedToCloudToast'));
      presenceActions.recordAction(`Saved BIM model "${lastFileRef.current?.name ?? 'file'}" to cloud`);
    },
    onError: () => {
      setError(t('bimViewer', 'saveToCloudFailed'));
    },
  });

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

      sceneStateRef.current.addReferencePlane = (
        canvas: HTMLCanvasElement,
        worldWidth: number,
        worldDepth: number,
      ) => {
        // IFC/DXF loads offset this group to center meshes; PDF/images must sit at origin.
        meshGroup.position.set(0, 0, 0);
        meshGroup.rotation.set(0, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.DoubleSide,
          transparent: false,
        });
        const geo = new THREE.PlaneGeometry(worldWidth, worldDepth);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.01;
        (mesh as any).userData = { kind: 'pdf-reference-plane' };
        meshGroup.add(mesh);

        const radius = Math.max(worldWidth, worldDepth) * 0.6;
        camera.position.set(radius * 1.1, radius * 0.7, radius * 1.1);
        controls.target.set(0, 0, 0);
        controls.update();
      };

      sceneStateRef.current.clearMeshes = () => {
        while (meshGroup.children.length > 0) {
          const child = meshGroup.children[0];
          meshGroup.remove(child);
          if ((child as any).geometry) (child as any).geometry.dispose();
          const mat = (child as any).material;
          if (mat?.map?.dispose) mat.map.dispose();
          if (mat?.dispose) mat.dispose();
        }
        meshGroup.position.set(0, 0, 0);
        meshGroup.rotation.set(0, 0, 0);
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
      if (!cancelled) setSceneReady(true);
    })().catch((err) => {
      if (cancelled) return;
      setError((err as Error)?.message || 'Failed to initialise 3D scene');
    });

    return () => {
      cancelled = true;
      setSceneReady(false);
      cleanup?.();
    };
  }, []);

  const processBuffer = useCallback(
    async (
      buffer: ArrayBuffer,
      fileLabel: string,
      options?: { skipTrack?: boolean; fromCloud?: boolean; pdfPage?: number },
    ) => {
      const ext = fileLabel.split('.').pop()?.toLowerCase();
      const knownCad = new Set(['ifc', 'dxf', 'pdf', 'dwg']);
      if (!ext || (!knownCad.has(ext) && !isRasterExtension(ext))) {
        setError(t('bimViewer', 'unsupportedFormat'));
        return;
      }

      if (ext !== 'pdf') {
        lastPdfBufferRef.current = null;
        lastPdfFilenameRef.current = null;
        setPdfNumPages(0);
        setPdfPage(1);
      }

      if (ext === 'dwg') {
        setError(null);
        setStats(null);
        setFilename(fileLabel);
        if (options?.fromCloud) {
          setInfo(t('bimViewer', 'dwgFromCloudHint'));
          return;
        }
        setInfo(null);
        setBusy(true);
        try {
          const blob = new Blob([buffer], { type: 'application/acad' });
          const f = new File([blob], fileLabel, { type: 'application/acad' });
          await bimApi.uploadModel(f);
          queryClient.invalidateQueries({ queryKey: ['bim-models'] });
          setInfo(t('bimViewer', 'dwgUploadedCloud'));
          presenceActions.recordAction(`Stored DWG "${fileLabel}" in cloud (pending conversion)`);
        } catch {
          setError(t('bimViewer', 'dwgSaveFailed'));
          setInfo(null);
        } finally {
          setBusy(false);
        }
        return;
      }

      setError(null);
      setInfo(null);
      setBusy(true);
      const start = performance.now();
      try {
        if (ext === 'pdf') {
          const pageReq = Math.max(1, options?.pdfPage ?? 1);
          const result = await renderPdfPageToPlane(buffer, pageReq);
          sceneStateRef.current.clearMeshes?.();
          sceneStateRef.current.addReferencePlane?.(
            result.canvas,
            result.worldWidth,
            result.worldDepth,
          );
          const durationMs = Math.round(performance.now() - start);
          setPdfNumPages(result.numPages);
          setPdfPage(result.renderedPage);
          setStats({
            meshCount: 1,
            byType: { PdfReferencePlane: 1 },
            durationMs,
            referenceOnly: true,
          });
          setFilename(fileLabel);
          setInfo(t('bimViewer', 'pdfReferenceHint'));
          if (!options?.skipTrack) {
            bimApi
              .trackUpload({
                filename: fileLabel,
                mimeType: 'application/pdf',
                sizeBytes: buffer.byteLength,
                metadata: {
                  kind: 'pdf',
                  referenceOnly: true,
                  pageWidthPt: result.pageWidthPt,
                  pageHeightPt: result.pageHeightPt,
                  durationMs,
                  pdfPage: result.renderedPage,
                  pdfNumPages: result.numPages,
                },
              })
              .catch(() => undefined);
          }
          presenceActions.recordAction(
            `Loaded PDF "${fileLabel}" page ${result.renderedPage}/${result.numPages} as reference plane`,
          );
          return;
        }

        if (isRasterExtension(ext)) {
          const mime = mimeTypeForRasterExtension(ext);
          const result = await renderRasterImageToPlane(buffer, mime);
          sceneStateRef.current.clearMeshes?.();
          sceneStateRef.current.addReferencePlane?.(result.canvas, result.worldWidth, result.worldDepth);
          const durationMs = Math.round(performance.now() - start);
          setPdfNumPages(0);
          setPdfPage(1);
          setStats({
            meshCount: 1,
            byType: { ImageReferencePlane: 1 },
            durationMs,
            referenceOnly: true,
          });
          setFilename(fileLabel);
          setInfo(t('bimViewer', 'imageReferenceHint'));
          if (!options?.skipTrack) {
            bimApi
              .trackUpload({
                filename: fileLabel,
                mimeType: mime,
                sizeBytes: buffer.byteLength,
                metadata: {
                  kind: 'image',
                  referenceOnly: true,
                  pixelWidth: result.pixelWidth,
                  pixelHeight: result.pixelHeight,
                  worldWidth: result.worldWidth,
                  worldDepth: result.worldDepth,
                  durationMs,
                },
              })
              .catch(() => undefined);
          }
          presenceActions.recordAction(`Loaded image "${fileLabel}" as reference plane (${result.pixelWidth}×${result.pixelHeight}px)`);
          return;
        }

        let meshes: IfcMeshData[];
        let warnings: string[] = [];
        if (ext === 'dxf') {
          const result = buildBimFromDxf(buffer);
          meshes = result.meshes;
          warnings = result.warnings;
        } else {
          meshes = await parseIfcToMeshes(buffer);
        }
        sceneStateRef.current.clearMeshes?.();
        sceneStateRef.current.addMeshes?.(meshes);
        const byType: Record<string, number> = {};
        for (const m of meshes) {
          byType[m.elementType] = (byType[m.elementType] ?? 0) + 1;
        }
        const durationMs = Math.round(performance.now() - start);
        setStats({ meshCount: meshes.length, byType, durationMs });
        setFilename(fileLabel);
        if (warnings.length > 0) {
          setError(warnings.join(' / '));
        }

        if (!options?.skipTrack) {
          bimApi
            .trackUpload({
              filename: fileLabel,
              mimeType: 'application/octet-stream',
              sizeBytes: buffer.byteLength,
              metadata: { meshCount: meshes.length, byType, durationMs, kind: ext },
            })
            .catch(() => undefined);
        }
        presenceActions.recordAction(`Rendered ${ext.toUpperCase()} "${fileLabel}" (${meshes.length} meshes)`);
      } catch (err) {
        setError((err as Error)?.message || t('bimViewer', 'parseFailed'));
      } finally {
        setBusy(false);
      }
    },
    [presenceActions, queryClient, t],
  );

  const processBufferRef = useRef(processBuffer);
  processBufferRef.current = processBuffer;

  const handleFile = useCallback(
    async (file: File) => {
      lastFileRef.current = file;
      const buffer = await file.arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') {
        lastPdfBufferRef.current = buffer.slice(0);
        lastPdfFilenameRef.current = file.name;
      }
      await processBuffer(buffer, file.name);
    },
    [processBuffer],
  );

  const goPdfPage = useCallback(
    async (nextPage: number) => {
      const buf = lastPdfBufferRef.current;
      const label = lastPdfFilenameRef.current;
      if (!buf || !label || pdfNumPages < 2) return;
      const p = Math.max(1, Math.min(nextPage, pdfNumPages));
      setBusy(true);
      setError(null);
      try {
        await processBufferRef.current(buf, label, { skipTrack: true, pdfPage: p });
      } finally {
        setBusy(false);
      }
    },
    [pdfNumPages],
  );

  useEffect(() => {
    const modelId = searchParams.get('model');
    if (!modelId || !sceneReady || !accessQuery.data?.bim?.hasAccess) return;
    if (!sceneStateRef.current.addMeshes && !sceneStateRef.current.addReferencePlane) return;
    if (loadedRemoteModelIdRef.current === modelId) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const meta = await bimApi.getModel(modelId);
        if (cancelled) return;
        const { url } = await bimApi.getModelDownloadUrl(modelId);
        if (cancelled) return;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Download failed');
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        loadedRemoteModelIdRef.current = modelId;
        lastFileRef.current = null;
        const lower = meta.filename.toLowerCase();
        if (lower.endsWith('.pdf')) {
          lastPdfBufferRef.current = buf.slice(0);
          lastPdfFilenameRef.current = meta.filename;
        } else {
          lastPdfBufferRef.current = null;
          lastPdfFilenameRef.current = null;
        }
        await processBufferRef.current(buf, meta.filename, { skipTrack: true, fromCloud: true });
      } catch {
        if (!cancelled) {
          loadedRemoteModelIdRef.current = null;
          setError(t('bimViewer', 'cloudModelLoadFailed'));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, sceneReady, accessQuery.data?.bim?.hasAccess, t]);

  if (!hasToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-violet-500" aria-hidden />
        <span className="sr-only">{t('bimViewer', 'redirecting')}</span>
      </div>
    );
  }

  if (accessQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-violet-500" aria-hidden />
      </div>
    );
  }

  if (accessQuery.isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-3" aria-hidden />
        <p className="text-sm text-gray-700 text-center max-w-md">{t('bimLanding', 'accessErrorBody')}</p>
        <Link
          href="/login?next=%2Fbim%2Fviewer"
          className="mt-4 text-sm font-medium text-violet-700 hover:underline"
        >
          {t('bimLanding', 'anonLogIn')}
        </Link>
      </div>
    );
  }

  if (accessQuery.isSuccess && accessQuery.data && !accessQuery.data.bim?.hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-amber-200 p-8 text-center shadow-sm">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" aria-hidden />
          <h1 className="text-lg font-semibold text-gray-900">{t('bimLanding', 'lockedTitle')}</h1>
          <p className="text-sm text-gray-600 mt-2">{t('bimLanding', 'lockedBody')}</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            <Link
              href="/bim"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-50"
            >
              {t('bimViewer', 'back')}
            </Link>
            <Link
              href="/billing#bim"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
            >
              {t('products', 'subscribeCta')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/bim"
            className="inline-flex items-center gap-1.5 text-sm text-violet-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('bimViewer', 'back')}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ifc,.dxf,.pdf,.dwg,.png,.jpg,.jpeg,.webp,.gif,.bmp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            <button
              disabled={busy || saveToCloud.isPending}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 text-sm"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t('bimViewer', 'openFile')}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                saveToCloud.isPending ||
                !lastFileRef.current ||
                lastFileRef.current.name.toLowerCase().endsWith('.dwg')
              }
              onClick={() => {
                const f = lastFileRef.current;
                if (!f) return;
                const base = f.name.replace(/\.[^./\\]+$/, '') || f.name;
                const entered = window.prompt(t('bimViewer', 'saveNamePrompt'), base);
                if (entered === null) return;
                saveToCloud.mutate({
                  file: f,
                  displayName: entered.trim() || undefined,
                });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 text-sm"
            >
              {saveToCloud.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Cloud className="h-4 w-4" />
              )}
              {t('bimViewer', 'saveToCloud')}
            </button>
            <button
              onClick={() => {
                sceneStateRef.current.clearMeshes?.();
                setStats(null);
                setFilename(null);
                setError(null);
                setInfo(null);
                lastFileRef.current = null;
                lastPdfBufferRef.current = null;
                lastPdfFilenameRef.current = null;
                setPdfNumPages(0);
                setPdfPage(1);
                loadedRemoteModelIdRef.current = null;
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              {t('bimViewer', 'clear')}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden relative">
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
        </div>

        {stats?.referenceOnly && pdfNumPages > 1 && (
          <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">{t('bimViewer', 'pdfPagesTitle')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || pdfPage <= 1}
                onClick={() => void goPdfPage(pdfPage - 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-40"
              >
                {t('bimViewer', 'pdfPrev')}
              </button>
              <span className="text-sm text-gray-600 tabular-nums min-w-[5rem] text-center">
                {t('bimViewer', 'pdfPageOf')
                  .replace('{n}', String(pdfPage))
                  .replace('{total}', String(pdfNumPages))}
              </span>
              <button
                type="button"
                disabled={busy || pdfPage >= pdfNumPages}
                onClick={() => void goPdfPage(pdfPage + 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-40"
              >
                {t('bimViewer', 'pdfNext')}
              </button>
            </div>
          </div>
        )}

        {info && !error && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-3 flex items-start gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>{info}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {stats && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('bimViewer', 'statsTitle')}</h2>
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

export default function BimViewerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <Loader2 className="h-10 w-10 animate-spin text-violet-500" aria-hidden />
        </div>
      }
    >
      <BimViewerPageInner />
    </Suspense>
  );
}
