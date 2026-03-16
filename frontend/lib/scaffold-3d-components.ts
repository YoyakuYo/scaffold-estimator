/**
 * Simple 3D scaffold components — generic geometry only (no images/textures).
 * Posts = cylinders, planks = boxes, braces = thin cylinders.
 * For stable structural visualization only.
 */

import type { MeshStandardMaterial } from 'three';

type ThreeNS = typeof import('three');

const PIPE_R = 0.024;
const PIPE_SEG = 10;

/** Simple vertical post: single cylinder from yBase to yBase+heightM. One post type only. */
export function addSimplePost(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number,
  yBase: number,
  z: number,
  heightM: number,
  material: MeshStandardMaterial,
  pipeR: number = PIPE_R,
): void {
  if (heightM < 0.001) return;
  const geo = new THREE.CylinderGeometry(pipeR, pipeR, heightM, PIPE_SEG);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, yBase + heightM / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

/** Simple jack base: small box (base plate only). */
export function addSimpleJack(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number,
  y: number,
  z: number,
  material: MeshStandardMaterial,
  _pipeR: number = PIPE_R,
  _rodHeightM?: number,
): void {
  const plateW = 0.12;
  const plateH = 0.02;
  const geo = new THREE.BoxGeometry(plateW, plateH, plateW);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y + plateH / 2, z);
  mesh.castShadow = true;
  parent.add(mesh);
}

/** Simple plank: rectangular box with optional texture tiling. */
export function addSimplePlank(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  midX: number,
  midY: number,
  midZ: number,
  lengthM: number,
  widthM: number,
  material: MeshStandardMaterial,
): void {
  const thick = 0.025;
  const geo = new THREE.BoxGeometry(lengthM, thick, widthM);
  if (material.map) {
    const uvAttr = geo.getAttribute('uv');
    if (uvAttr) {
      const repeatX = lengthM / 0.5;
      const repeatZ = widthM / 0.25;
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setX(i, uvAttr.getX(i) * repeatX);
        uvAttr.setY(i, uvAttr.getY(i) * repeatZ);
      }
      uvAttr.needsUpdate = true;
    }
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(midX, midY, midZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

/** Simple horizontal bar: thin cylinder between (x1,z1) and (x2,z2) at height y. */
export function addSimpleNunoBar(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x1: number,
  y: number,
  z1: number,
  x2: number,
  z2: number,
  material: MeshStandardMaterial,
  pipeR: number = PIPE_R * 0.85,
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
  // Cylinder default axis is Y; lay it in XZ so bar is horizontal along (dx, dz).
  mesh.rotation.x = Math.PI / 2;
  mesh.rotation.z = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  parent.add(mesh);
}

/** Simple X-brace: two diagonal thin cylinders between (x1,y1) and (x2,y2) at z. Connects two posts. */
export function addSimpleBrace(
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
}

/** Simple habaki / toe board: thin box. */
export function addSimpleHabaki(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  midX: number,
  midY: number,
  midZ: number,
  lengthM: number,
  material: MeshStandardMaterial,
): void {
  const geo = new THREE.BoxGeometry(lengthM, 0.08, 0.015);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(midX, midY, midZ);
  mesh.castShadow = true;
  parent.add(mesh);
}

// Legacy names: point to simple versions so existing view code can switch gradually or we keep one set of names.
export const addRealisticPost = addSimplePost;
export const addRealisticJack = addSimpleJack;
export const addRealisticPlank = addSimplePlank;
export const addRealisticNunoBar = addSimpleNunoBar;
export const addRealisticBrace = addSimpleBrace;
export const addRealisticHabaki = addSimpleHabaki;

export function loadScaffoldTextures(
  THREE: ThreeNS,
  _baseUrl?: string,
): Promise<ScaffoldTextureSet> {
  const color = 0xc0c8d0;
  const pipe = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  const pipeDark = new THREE.MeshStandardMaterial({ color: 0xa0a8b0, metalness: 0.5, roughness: 0.4 });

  return new Promise<ScaffoldTextureSet>((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/plank.png',
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        const plankMat = new THREE.MeshStandardMaterial({
          map: tex,
          metalness: 0.55,
          roughness: 0.35,
          color: 0xd0d8e0,
        });
        resolve({ post: null, jack: null, plank: plankMat, nuno: null, brace: null, habaki: null, pipe, pipeDark });
      },
      undefined,
      () => {
        resolve({ post: null, jack: null, plank: null, nuno: null, brace: null, habaki: null, pipe, pipeDark });
      },
    );
  });
}

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
