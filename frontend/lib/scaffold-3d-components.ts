/**
 * Realistic 3D scaffold components — PBR materials with procedural textures,
 * base plates, coupler hints, and environment-ready rendering.
 */

import type { MeshStandardMaterial } from 'three';

type ThreeNS = typeof import('three');

export const PIPE_R = 0.024;
const PIPE_SEG = 12;

// ── Procedural Texture Generators ─────────────────────────────

export function createMetalTextures(THREE: ThreeNS) {
  const W = 256, H = 256;
  const dc = document.createElement('canvas');
  dc.width = W; dc.height = H;
  const d = dc.getContext('2d')!;
  d.fillStyle = '#9ca4ac';
  d.fillRect(0, 0, W, H);
  const dd = d.getImageData(0, 0, W, H);
  for (let i = 0; i < dd.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    dd.data[i]     = Math.min(255, Math.max(0, dd.data[i] + n));
    dd.data[i + 1] = Math.min(255, Math.max(0, dd.data[i + 1] + n + 2));
    dd.data[i + 2] = Math.min(255, Math.max(0, dd.data[i + 2] + n + 4));
  }
  d.putImageData(dd, 0, 0);
  for (let i = 0; i < 50; i++) {
    const y = Math.random() * H;
    d.strokeStyle = `rgba(160,168,178,${0.06 + Math.random() * 0.1})`;
    d.lineWidth = 0.5 + Math.random() * 1.5;
    d.beginPath(); d.moveTo(0, y); d.lineTo(W, y + (Math.random() - 0.5) * 3); d.stroke();
  }
  const map = new THREE.CanvasTexture(dc);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;

  const nc = document.createElement('canvas');
  nc.width = 128; nc.height = 128;
  const n = nc.getContext('2d')!;
  n.fillStyle = 'rgb(128,128,255)';
  n.fillRect(0, 0, 128, 128);
  const nd = n.getImageData(0, 0, 128, 128);
  for (let i = 0; i < nd.data.length; i += 4) {
    nd.data[i]     = 128 + (Math.random() - 0.5) * 8;
    nd.data[i + 1] = 128 + (Math.random() - 0.5) * 8;
  }
  n.putImageData(nd, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;

  const rc = document.createElement('canvas');
  rc.width = 128; rc.height = 128;
  const r = rc.getContext('2d')!;
  r.fillStyle = 'rgb(60,60,60)';
  r.fillRect(0, 0, 128, 128);
  const rd = r.getImageData(0, 0, 128, 128);
  for (let i = 0; i < rd.data.length; i += 4) {
    const v = 50 + Math.random() * 25;
    rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = v;
  }
  r.putImageData(rd, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  return { map, normalMap, roughnessMap };
}

export function createWoodTextures(THREE: ThreeNS) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  // Yellow-gold base so planks/habaki read clearly (not muddy)
  ctx.fillStyle = '#d4b050';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    const hue = 42 + Math.sin(y * 0.15) * 4;
    const light = 62 + Math.sin(y * 0.3) * 6 + (Math.random() - 0.5) * 4;
    ctx.strokeStyle = `hsl(${hue},50%,${light}%)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let i = 0; i < 25; i++) {
    const y = Math.random() * H;
    ctx.strokeStyle = `rgba(140,110,30,${0.05 + Math.random() * 0.08})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath(); ctx.moveTo(0, y);
    for (let x = 0; x < W; x += 15) ctx.lineTo(x, y + Math.sin(x * 0.02) * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 2; i++) {
    const kx = 50 + Math.random() * (W - 100);
    const ky = 20 + Math.random() * (H - 40);
    const kr = 4 + Math.random() * 8;
    const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
    grad.addColorStop(0, 'rgba(100,75,20,0.25)');
    grad.addColorStop(1, 'rgba(100,75,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI * 2); ctx.fill();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;

  const nc = document.createElement('canvas');
  nc.width = 256; nc.height = 128;
  const nCtx = nc.getContext('2d')!;
  nCtx.fillStyle = 'rgb(128,128,255)';
  nCtx.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 128; y++) {
    const off = Math.sin(y * 0.4) * 3;
    nCtx.strokeStyle = `rgb(${128 + Math.round(off)},128,255)`;
    nCtx.lineWidth = 1;
    nCtx.beginPath(); nCtx.moveTo(0, y); nCtx.lineTo(256, y); nCtx.stroke();
  }
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;

  return { map, normalMap };
}

export function createConcreteTexture(THREE: ThreeNS) {
  const SZ = 512;
  const c = document.createElement('canvas');
  c.width = SZ; c.height = SZ;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8a8580';
  ctx.fillRect(0, 0, SZ, SZ);
  const data = ctx.getImageData(0, 0, SZ, SZ);
  for (let i = 0; i < data.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    data.data[i]     = Math.min(255, Math.max(0, 138 + n));
    data.data[i + 1] = Math.min(255, Math.max(0, 133 + n));
    data.data[i + 2] = Math.min(255, Math.max(0, 128 + n));
  }
  ctx.putImageData(data, 0, 0);
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(100,95,90,${0.14 + Math.random() * 0.08})`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    let x = Math.random() * SZ, y = Math.random() * SZ;
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(8, 8);
  return { map };
}

export function createEnvironmentCubemap(THREE: ThreeNS) {
  const size = 64;
  function makeFace(top: string, bot: string) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    return c;
  }
  const faces = [
    makeFace('#4a6b80', '#6b7d8a'),
    makeFace('#4a6b80', '#6b7d8a'),
    makeFace('#3d5f70', '#3d5f70'),
    makeFace('#7a7570', '#7a7570'),
    makeFace('#4a6b80', '#6b7d8a'),
    makeFace('#4a6b80', '#6b7d8a'),
  ];
  const tex = new THREE.CubeTexture(faces);
  tex.needsUpdate = true;
  return tex;
}

export function createSkyGradientTexture(THREE: ThreeNS) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#2a5070');
  g.addColorStop(0.3, '#3d6080');
  g.addColorStop(0.55, '#5a7088');
  g.addColorStop(0.78, '#7a8894');
  g.addColorStop(1.0, '#8a929c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

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
  const color = 0xc0c8d0;
  const pipe = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  const pipeDark = new THREE.MeshStandardMaterial({ color: 0xa0a8b0, metalness: 0.5, roughness: 0.4 });
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
