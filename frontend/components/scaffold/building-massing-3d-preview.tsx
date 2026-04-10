'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { VisionMassingTier } from '@/lib/api/vision-bim';
import { computeBimPreviewPlanToM } from '@/lib/bim-preview-plan-coords';
import { normalizeMassingTiersForPreview } from '@/lib/massing-tiers-preview-normalize';

/** 3D building massing preview — stacked tiers or single extrusion (Three.js). Drag to orbit, wheel to zoom. */
export function Building3DPreview({
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
  style?: CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<import('three').WebGLRenderer | null>(null);
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

      const spreadX = Math.max(...pts2D.map((p) => p.x)) - Math.min(...pts2D.map((p) => p.x));
      const spreadZ = Math.max(...pts2D.map((p) => p.z)) - Math.min(...pts2D.map((p) => p.z));
      if (spreadX < 0.01 && spreadZ < 0.01) {
        setPreviewError('建物形状が小さすぎて3D描画できません。壁面長を確認してください。');
        return;
      }

      const heightM = buildingHeightMm * 0.001;
      const hasSteppedHeights =
        Array.isArray(wallHeightsMm) &&
        wallHeightsMm.length === outline.length &&
        new Set(wallHeightsMm).size > 1;

      const fallbackGroup = new THREE.Group();
      const hasMassingTiers = previewMassingTiers.length > 0;

      if (hasMassingTiers) {
        const tiers = [...previewMassingTiers]
          .filter((tier) => Array.isArray(tier.vertices) && tier.vertices.length >= 3)
          .sort(
            (a, b) =>
              (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0) || a.topHeightMm - b.topHeightMm,
          );
        const tierMat = new THREE.MeshStandardMaterial({
          color: 0xd4d8e0,
          metalness: 0.1,
          roughness: 0.7,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
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
            fallbackGroup.add(
              new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(floorPts),
                new THREE.LineBasicMaterial({ color: 0xbdc3cf, transparent: true, opacity: 0.5 }),
              ),
            );
          }
        }
      } else if (hasSteppedHeights) {
        const buildingMat = new THREE.MeshStandardMaterial({
          color: 0xd4d8e0,
          metalness: 0.1,
          roughness: 0.7,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
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
            p0x, 0, p0z, p1x, 0, p1z, p1x, wH, p1z, p0x, 0, p0z, p1x, wH, p1z, p0x, wH, p0z,
          ]);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geo.computeVertexNormals();
          fallbackGroup.add(new THREE.Mesh(geo, buildingMat));

          const wallEdgePts = [
            new THREE.Vector3(p0x, 0, p0z),
            new THREE.Vector3(p1x, 0, p1z),
            new THREE.Vector3(p1x, wH, p1z),
            new THREE.Vector3(p0x, wH, p0z),
            new THREE.Vector3(p0x, 0, p0z),
          ];
          fallbackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wallEdgePts), edgeMat));
        }

        const floorH = 3;
        const uniqueHeights = [...new Set(wallHeightsMm!)].sort((a, b) => a - b);
        for (const hi of uniqueHeights) {
          const hM = hi * 0.001;
          const capPts = pts2D
            .filter((_, ii) => (wallHeightsMm![ii] ?? buildingHeightMm) >= hi)
            .map((p) => new THREE.Vector3(p.x - cx, hM, p.z - cz));
          if (capPts.length >= 3) {
            capPts.push(capPts[0].clone());
            fallbackGroup.add(
              new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(capPts),
                new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.4 }),
              ),
            );
          }
        }

        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const wH = (wallHeightsMm![i] ?? buildingHeightMm) * 0.001;
          for (let floorY = floorH; floorY < wH; floorY += floorH) {
            const pts = [
              new THREE.Vector3(pts2D[i].x - cx, floorY, pts2D[i].z - cz),
              new THREE.Vector3(pts2D[j].x - cx, floorY, pts2D[j].z - cz),
            ];
            fallbackGroup.add(
              new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(pts),
                new THREE.LineBasicMaterial({ color: 0xbdc3cf, transparent: true, opacity: 0.5 }),
              ),
            );
          }
        }
      } else {
        const shape = new THREE.Shape();
        shape.moveTo(pts2D[0].x - cx, -(pts2D[0].z - cz));
        for (let i = 1; i < pts2D.length; i++) {
          shape.lineTo(pts2D[i].x - cx, -(pts2D[i].z - cz));
        }
        shape.closePath();

        const buildingGeo = new THREE.ExtrudeGeometry(shape, { depth: heightM, bevelEnabled: false });
        const buildingMat = new THREE.MeshStandardMaterial({
          color: 0xd4d8e0,
          metalness: 0.1,
          roughness: 0.7,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
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
          fallbackGroup.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(floorPts),
              new THREE.LineBasicMaterial({ color: 0xbdc3cf, transparent: true, opacity: 0.5 }),
            ),
          );
        }
      }

      scene.add(fallbackGroup);

      const outlinePts = pts2D.map((p) => new THREE.Vector3(p.x - cx, 0.01, p.z - cz));
      outlinePts.push(outlinePts[0].clone());
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outlineLine = new THREE.Line(
        outlineGeo,
        new THREE.LineBasicMaterial({ color: 0x6366f1, linewidth: 2 }),
      );
      scene.add(outlineLine);

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

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(extent, extent * 1.5, extent * 0.8);
      scene.add(dirLight);

      const dist = Math.max(extent * 1.8, heightM * 2, 8);
      camera.position.set(dist * 0.2, dist * 0.6, dist * 0.85);
      camera.lookAt(0, heightM * 0.35, 0);
      camera.far = dist * 10;
      camera.updateProjectionMatrix();

      const target = new THREE.Vector3(0, heightM * 0.35, 0);
      const spherical = new THREE.Spherical().setFromVector3(
        new THREE.Vector3().subVectors(camera.position, target),
      );
      let dragging = false;
      let prevX = 0;
      let prevY = 0;

      const onDown = (e: MouseEvent) => {
        dragging = true;
        prevX = e.clientX;
        prevY = e.clientY;
      };
      const onUp = () => {
        dragging = false;
      };
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
      <div
        className={`flex items-center justify-center text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg ${className ?? ''}`}
        style={style}
      >
        {previewError}
      </div>
    );
  }
  return <div ref={containerRef} className={className} style={style} />;
}
