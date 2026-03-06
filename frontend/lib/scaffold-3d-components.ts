/**
 * Realistic 3D scaffold components — match reference images (post, jack, plank, nuno, brace).
 * Uses textures from /scaffold-textures/ when available; otherwise fallback materials.
 * All dimensions in meters (m). Sizes come from the existing calculator; this only changes appearance.
 */

import type { MeshStandardMaterial } from 'three';

export interface ScaffoldTextureSet {
  post: MeshStandardMaterial | null;
  jack: MeshStandardMaterial | null;
  plank: MeshStandardMaterial | null;
  nuno: MeshStandardMaterial | null;
  brace: MeshStandardMaterial | null;
  habaki: MeshStandardMaterial | null;
  pipe: MeshStandardMaterial;
  pipeDark: MeshStandardMaterial;
}

type ThreeNS = typeof import('three');

const PIPE_R = 0.024;
const PIPE_SEG = 10;

const FALLBACK_COLORS = {
  pipe: 0xdbe5f0,
  pipeDark: 0x9fb3c8,
  plank: 0xfbbf24,
  jackBase: 0x7c8ea3,
  habaki: 0xf59e0b,
};

/**
 * Load textures from /scaffold-textures/ and build materials. Missing files → null (use fallback).
 */
export function loadScaffoldTextures(
  THREE: ThreeNS,
  baseUrl: string = '/scaffold-textures',
): Promise<ScaffoldTextureSet> {
  const loader = new THREE.TextureLoader();
  const fallback = (color: number, metalness = 0.5, roughness = 0.4) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });

  const pipeMat = fallback(FALLBACK_COLORS.pipe, 0.6, 0.35);
  const pipeDarkMat = fallback(FALLBACK_COLORS.pipeDark, 0.5, 0.4);

  const load = (name: string): Promise<MeshStandardMaterial | null> =>
    new Promise((resolve) => {
      loader.load(
        `${baseUrl}/${name}.png`,
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = (THREE as any).SRGBColorSpace ?? 'srgb';
          resolve(
            new THREE.MeshStandardMaterial({
              map: tex,
              metalness: 0.5,
              roughness: 0.45,
              side: THREE.DoubleSide,
            }),
          );
        },
        undefined,
        () => resolve(null),
      );
    });

  return Promise.all([
    load('post'),
    load('jack-base'),
    load('plank'),
    load('nuno'),
    load('brace-handrail'),
    load('habaki'),
  ]).then(([post, jack, plank, nuno, brace, habaki]) => ({
    post,
    jack,
    plank,
    nuno,
    brace,
    habaki,
    pipe: pipeMat,
    pipeDark: pipeDarkMat,
  }));
}

/** Realistic post (支柱): cylinder with wedge collars at intervals, optional texture. */
export function addRealisticPost(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number,
  yBase: number,
  z: number,
  heightM: number,
  material: MeshStandardMaterial,
  pipeR: number = PIPE_R,
): void {
  const collarInterval = 0.6;
  const collarH = 0.03;
  const collarR = pipeR * 1.35;
  const segments = Math.max(8, Math.floor(heightM / collarInterval));
  const main = new THREE.CylinderGeometry(pipeR, pipeR, heightM, PIPE_SEG);
  const mesh = new THREE.Mesh(main, material);
  mesh.position.set(x, yBase + heightM / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  for (let i = 1; i <= segments; i++) {
    const cy = yBase + (heightM * i) / (segments + 1);
    const ring = new THREE.CylinderGeometry(collarR, collarR, collarH, 12);
    const ringMesh = new THREE.Mesh(ring, material);
    ringMesh.position.set(x, cy, z);
    ringMesh.castShadow = true;
    parent.add(ringMesh);
  }
  const topPin = new THREE.CylinderGeometry(pipeR * 0.7, pipeR, 0.04, 10);
  const pinMesh = new THREE.Mesh(topPin, material);
  pinMesh.position.set(x, yBase + heightM, z);
  parent.add(pinMesh);
}

/** Realistic jack base (ジャッキベース): square plate + threaded rod + T-handle. */
export function addRealisticJack(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number,
  y: number,
  z: number,
  material: MeshStandardMaterial,
  pipeR: number = PIPE_R,
  rodHeightM: number = 0.28,
): void {
  const plateW = 0.15;
  const plateH = 0.012;
  const rodH = Math.max(0.05, rodHeightM - plateH);
  const plateGeo = new THREE.BoxGeometry(plateW, plateH, plateW);
  const plate = new THREE.Mesh(plateGeo, material);
  plate.position.set(x, y + plateH / 2, z);
  plate.castShadow = true;
  parent.add(plate);
  const rodGeo = new THREE.CylinderGeometry(pipeR * 0.9, pipeR * 0.9, rodH, 12);
  const rod = new THREE.Mesh(rodGeo, material);
  rod.position.set(x, y + plateH + rodH / 2, z);
  rod.castShadow = true;
  parent.add(rod);
  const nutH = 0.04;
  const nutR = pipeR * 1.4;
  const nutGeo = new THREE.CylinderGeometry(nutR, nutR, nutH, 12);
  const nut = new THREE.Mesh(nutGeo, material);
  nut.position.set(x, y + plateH + rodH - nutH / 2, z);
  parent.add(nut);
  const handleLen = 0.08;
  const handleBar = new THREE.CylinderGeometry(0.008, 0.008, handleLen, 8);
  const handle = new THREE.Mesh(handleBar, material);
  handle.position.set(x + handleLen / 2, y + plateH + rodH - nutH / 2, z);
  handle.rotation.z = -Math.PI / 2;
  parent.add(handle);
}

/** Realistic plank (踏板 Anchi): flat deck with thickness; texture shows perforation. */
export function addRealisticPlank(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  midX: number,
  midY: number,
  midZ: number,
  lengthM: number,
  widthM: number,
  material: MeshStandardMaterial,
): void {
  const thick = 0.028;
  const geo = new THREE.BoxGeometry(lengthM, thick, widthM);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(midX, midY, midZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

/** Realistic nuno / ledger (布材): horizontal bar with hook-like ends. */
export function addRealisticNunoBar(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x1: number,
  y: number,
  z1: number,
  x2: number,
  z2: number,
  material: MeshStandardMaterial,
  pipeR: number = PIPE_R * 0.9,
): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) return;
  const midX = (x1 + x2) / 2;
  const midZ = (z1 + z2) / 2;
  const geo = new THREE.CylinderGeometry(pipeR, pipeR, len, PIPE_SEG);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(midX, y, midZ);
  mesh.rotation.z = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  parent.add(mesh);
  const hookR = pipeR * 1.2;
  const hookGeo = new THREE.SphereGeometry(hookR, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const hook1 = new THREE.Mesh(hookGeo, material);
  hook1.position.set(x1, y - hookR * 0.5, z1);
  parent.add(hook1);
  const hook2 = new THREE.Mesh(hookGeo, material);
  hook2.position.set(x2, y - hookR * 0.5, z2);
  parent.add(hook2);
}

/** Realistic X-brace (ブレス) with hook-style end caps. */
export function addRealisticBrace(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x1: number,
  y1: number,
  z: number,
  x2: number,
  y2: number,
  material: MeshStandardMaterial,
  pipeR: number = PIPE_R * 0.7,
): void {
  const addDiag = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;
    const geo = new THREE.CylinderGeometry(pipeR, pipeR, len, PIPE_SEG);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, z);
    mesh.rotation.z = -Math.atan2(dy, dx);
    mesh.castShadow = true;
    parent.add(mesh);
  };
  addDiag(x1, y1, x2, y2);
  addDiag(x1, y2, x2, y1);
  const capR = pipeR * 1.3;
  const capGeo = new THREE.SphereGeometry(capR, 6, 6);
  [x1, x2].forEach((px) => [y1, y2].forEach((py) => {
    const cap = new THREE.Mesh(capGeo, material);
    cap.position.set(px, py, z);
    parent.add(cap);
  }));
}

/** Habaki / toe board: thin strip; can use habaki texture if loaded. */
export function addRealisticHabaki(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  midX: number,
  midY: number,
  midZ: number,
  lengthM: number,
  material: MeshStandardMaterial,
): void {
  const geo = new THREE.BoxGeometry(lengthM, 0.1, 0.015);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(midX, midY, midZ);
  mesh.castShadow = true;
  parent.add(mesh);
}
