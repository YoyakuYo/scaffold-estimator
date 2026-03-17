/**
 * Professional BIM-quality 3D scaffold components.
 * Clean smooth materials (no noisy procedural textures).
 * Style reference: EK Scaffold Design tender renderings.
 */

import type { MeshStandardMaterial } from 'three';

type ThreeNS = typeof import('three');

export const PIPE_R = 0.024;
const PIPE_SEG = 12;

// ── BIM Scaffold Color Palette ────────────────────────────────
// Matches professional scaffold tender renderings:
//   Silver-grey tubes  |  Warm wood-brown planks  |  Red-brown base plates

export const BIM_COLORS = {
  pipe:      0xb0b8c0,  // clean silver-grey
  pipeDark:  0x98a0a8,  // slightly darker silver for braces
  plank:     0xc0884a,  // warm natural wood brown
  habaki:    0xb07840,  // slightly darker wood
  jack:      0x909898,  // medium grey
  basePlate: 0x8b4c2c,  // reddish-brown (like reference base plates)
  coupler:   0x7a7a7a,  // dark grey coupler rings
  tesuri:    0xb0b8c0,  // same silver as pipes
  yokoji:    0xc0c0c0,  // light silver
  stair:     0xa8b0b8,  // silver
  ground:    0xd8d4d0,  // light warm grey concrete
  ecoPallet: 0x2d2d2d,  // dark recycled plastic
};

// ── Geometry Helpers ──────────────────────────────────────────

export function addSimplePost(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number, yBase: number, z: number,
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

export function addSimpleJack(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number, y: number, z: number,
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

export function addBasePlate(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number, y: number, z: number,
  material: MeshStandardMaterial,
): void {
  const plateW = 0.20;
  const plateH = 0.008;
  const geo = new THREE.BoxGeometry(plateW, plateH, plateW);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y + plateH / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

export function addCoupler(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x: number, y: number, z: number,
  material: MeshStandardMaterial,
): void {
  const r = PIPE_R * 1.7;
  const h = 0.032;
  const geo = new THREE.CylinderGeometry(r, r, h, 8);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
}

export function addSimplePlank(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  midX: number, midY: number, midZ: number,
  lengthM: number, widthM: number,
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

export function addSimpleNunoBar(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x1: number, y: number, z1: number,
  x2: number, z2: number,
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
  mesh.rotation.x = Math.PI / 2;
  mesh.rotation.z = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  parent.add(mesh);
}

export function addSimpleBrace(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  x1: number, y1: number, z: number,
  x2: number, y2: number,
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

export function addSimpleHabaki(
  THREE: ThreeNS,
  parent: InstanceType<ThreeNS['Object3D']>,
  midX: number, midY: number, midZ: number,
  lengthM: number,
  material: MeshStandardMaterial,
): void {
  const geo = new THREE.BoxGeometry(lengthM, 0.08, 0.015);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(midX, midY, midZ);
  mesh.castShadow = true;
  parent.add(mesh);
}

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
  const pipe = new THREE.MeshStandardMaterial({ color: BIM_COLORS.pipe, metalness: 0.55, roughness: 0.35 });
  const pipeDark = new THREE.MeshStandardMaterial({ color: BIM_COLORS.pipeDark, metalness: 0.55, roughness: 0.35 });
  return Promise.resolve({
    post: null, jack: null, plank: null, nuno: null, brace: null, habaki: null,
    pipe, pipeDark,
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
