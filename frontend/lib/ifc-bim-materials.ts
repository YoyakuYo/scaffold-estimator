/**
 * Realistic BIM material system for IFC model rendering.
 * Generates procedural PBR materials that match professional scaffold
 * tender renderings (EK Scaffold Design style): warm brick, dark slate
 * roofs, blue-tinted glass, concrete slabs, timber accents.
 */

import type { IfcElementType } from './ifc-loader';

type ThreeNS = typeof import('three');

export interface BimMaterialSet {
  wall: InstanceType<ThreeNS['MeshStandardMaterial']>;
  wallAlt: InstanceType<ThreeNS['MeshStandardMaterial']>;
  slab: InstanceType<ThreeNS['MeshStandardMaterial']>;
  roof: InstanceType<ThreeNS['MeshStandardMaterial']>;
  window: InstanceType<ThreeNS['MeshPhysicalMaterial']>;
  door: InstanceType<ThreeNS['MeshStandardMaterial']>;
  beam: InstanceType<ThreeNS['MeshStandardMaterial']>;
  column: InstanceType<ThreeNS['MeshStandardMaterial']>;
  railing: InstanceType<ThreeNS['MeshStandardMaterial']>;
  stair: InstanceType<ThreeNS['MeshStandardMaterial']>;
  curtainWall: InstanceType<ThreeNS['MeshPhysicalMaterial']>;
  covering: InstanceType<ThreeNS['MeshStandardMaterial']>;
  footing: InstanceType<ThreeNS['MeshStandardMaterial']>;
  plate: InstanceType<ThreeNS['MeshStandardMaterial']>;
  member: InstanceType<ThreeNS['MeshStandardMaterial']>;
  furniture: InstanceType<ThreeNS['MeshStandardMaterial']>;
  opening: InstanceType<ThreeNS['MeshStandardMaterial']>;
  unknown: InstanceType<ThreeNS['MeshStandardMaterial']>;
}

/**
 * Generate a procedural brick-like bump texture as a canvas.
 * Creates a repeating brick pattern with mortar lines.
 */
function createBrickBumpCanvas(
  width = 256,
  height = 256,
  brickRows = 8,
  brickCols = 4,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const mortarWidth = 2;
  const brickH = Math.floor(height / brickRows);
  const brickW = Math.floor(width / brickCols);

  ctx.fillStyle = '#8b6a4a';
  ctx.fillRect(0, 0, width, height);

  for (let row = 0; row < brickRows; row++) {
    const y = row * brickH;
    const offset = (row % 2) * (brickW / 2);

    for (let col = -1; col <= brickCols; col++) {
      const x = col * brickW + offset;

      const r = 140 + Math.floor(Math.random() * 50);
      const g = 85 + Math.floor(Math.random() * 35);
      const b = 55 + Math.floor(Math.random() * 25);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(
        x + mortarWidth,
        y + mortarWidth,
        brickW - mortarWidth * 2,
        brickH - mortarWidth * 2,
      );

      // Subtle brick face variation
      ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
      ctx.fillRect(
        x + mortarWidth + 2,
        y + mortarWidth + 2,
        brickW - mortarWidth * 2 - 4,
        brickH - mortarWidth * 2 - 4,
      );
    }
  }

  // Mortar lines
  ctx.strokeStyle = '#a09080';
  ctx.lineWidth = mortarWidth;
  for (let row = 0; row <= brickRows; row++) {
    const y = row * brickH;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let row = 0; row < brickRows; row++) {
    const y = row * brickH;
    const offset = (row % 2) * (brickW / 2);
    for (let col = 0; col <= brickCols + 1; col++) {
      const x = col * brickW + offset;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + brickH);
      ctx.stroke();
    }
  }

  return canvas;
}

/**
 * Generate a procedural roof tile pattern.
 */
function createRoofTileCanvas(
  width = 256,
  height = 256,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(0, 0, width, height);

  const tileRows = 12;
  const tileCols = 8;
  const tileH = height / tileRows;
  const tileW = width / tileCols;

  for (let row = 0; row < tileRows; row++) {
    const y = row * tileH;
    const offset = (row % 2) * (tileW / 2);

    for (let col = -1; col <= tileCols; col++) {
      const x = col * tileW + offset;

      const v = 38 + Math.floor(Math.random() * 18);
      ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
      ctx.fillRect(x + 1, y + 1, tileW - 2, tileH - 2);

      // Tile edge highlight
      ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
      ctx.fillRect(x + 1, y + 1, tileW - 2, 2);
    }
  }

  return canvas;
}

/**
 * Generate a subtle concrete texture.
 */
function createConcreteCanvas(
  width = 128,
  height = 128,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#c8c0b8';
  ctx.fillRect(0, 0, width, height);

  // Random noise for concrete grain
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const v = Math.random() * 0.12;
    ctx.fillStyle = `rgba(0,0,0,${v})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // A few faint form-lines
  ctx.strokeStyle = 'rgba(0,0,0,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = Math.random() * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }

  return canvas;
}

/**
 * Create full BIM material set from procedural textures.
 * Materials are designed to match the warm, detailed look of
 * professional scaffold tender renderings.
 */
export function createBimMaterialSet(THREE: ThreeNS): BimMaterialSet {
  // Procedural textures
  const brickCanvas = createBrickBumpCanvas();
  const brickTexture = new THREE.CanvasTexture(brickCanvas);
  brickTexture.wrapS = THREE.RepeatWrapping;
  brickTexture.wrapT = THREE.RepeatWrapping;
  brickTexture.repeat.set(3, 3);

  const roofCanvas = createRoofTileCanvas();
  const roofTexture = new THREE.CanvasTexture(roofCanvas);
  roofTexture.wrapS = THREE.RepeatWrapping;
  roofTexture.wrapT = THREE.RepeatWrapping;
  roofTexture.repeat.set(4, 4);

  const concreteCanvas = createConcreteCanvas();
  const concreteTexture = new THREE.CanvasTexture(concreteCanvas);
  concreteTexture.wrapS = THREE.RepeatWrapping;
  concreteTexture.wrapT = THREE.RepeatWrapping;
  concreteTexture.repeat.set(2, 2);

  // Brick wall: warm reddish-brown with texture
  const wall = new THREE.MeshStandardMaterial({
    map: brickTexture,
    color: 0xc4886a,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  // Alternate wall: lighter plaster/render
  const wallAlt = new THREE.MeshStandardMaterial({
    map: concreteTexture,
    color: 0xe0d4c4,
    roughness: 0.75,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  // Concrete slab/floor
  const slab = new THREE.MeshStandardMaterial({
    map: concreteTexture,
    color: 0xd4ccc0,
    roughness: 0.8,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  // Dark slate roof
  const roof = new THREE.MeshStandardMaterial({
    map: roofTexture,
    color: 0x2c2c34,
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  // Blue-tinted glass (physically based)
  const window = new THREE.MeshPhysicalMaterial({
    color: 0x88bbdd,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.45,
    transmission: 0.6,
    thickness: 0.02,
    side: THREE.DoubleSide,
    envMapIntensity: 1.5,
  });

  // Wooden door
  const door = new THREE.MeshStandardMaterial({
    color: 0x6b4226,
    roughness: 0.65,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  // Steel beam
  const beam = new THREE.MeshStandardMaterial({
    color: 0x8a8a8a,
    roughness: 0.4,
    metalness: 0.6,
    side: THREE.DoubleSide,
  });

  // Concrete column
  const column = new THREE.MeshStandardMaterial({
    map: concreteTexture,
    color: 0xb8b0a8,
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  // Metal railing
  const railing = new THREE.MeshStandardMaterial({
    color: 0x606068,
    roughness: 0.35,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });

  // Concrete stair
  const stair = new THREE.MeshStandardMaterial({
    map: concreteTexture,
    color: 0xc0b8b0,
    roughness: 0.75,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  // Curtain wall (glass facade)
  const curtainWall = new THREE.MeshPhysicalMaterial({
    color: 0x6699bb,
    roughness: 0.08,
    metalness: 0.2,
    transparent: true,
    opacity: 0.55,
    transmission: 0.5,
    thickness: 0.01,
    side: THREE.DoubleSide,
    envMapIntensity: 2.0,
  });

  // Covering/cladding
  const covering = new THREE.MeshStandardMaterial({
    color: 0xd8d0c4,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  // Concrete footing
  const footing = new THREE.MeshStandardMaterial({
    map: concreteTexture,
    color: 0xa8a098,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  // Metal plate
  const plate = new THREE.MeshStandardMaterial({
    color: 0x7a7a80,
    roughness: 0.4,
    metalness: 0.5,
    side: THREE.DoubleSide,
  });

  // Steel member
  const member = new THREE.MeshStandardMaterial({
    color: 0x909098,
    roughness: 0.4,
    metalness: 0.55,
    side: THREE.DoubleSide,
  });

  // Furniture
  const furniture = new THREE.MeshStandardMaterial({
    color: 0xb89060,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  // Opening (invisible/transparent)
  const opening = new THREE.MeshStandardMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });

  // Unknown / fallback
  const unknown = new THREE.MeshStandardMaterial({
    color: 0xc0b8b0,
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  return {
    wall, wallAlt, slab, roof, window, door, beam, column,
    railing, stair, curtainWall, covering, footing, plate,
    member, furniture, opening, unknown,
  };
}

/**
 * Get the appropriate material for an IFC element type.
 * Alternates wall materials based on expressID for visual variety.
 */
export function getMaterialForElement(
  materials: BimMaterialSet,
  elementType: IfcElementType,
  expressID: number,
): InstanceType<ThreeNS['Material']> {
  switch (elementType) {
    case 'wall':
      return (expressID % 3 === 0) ? materials.wallAlt : materials.wall;
    case 'slab':
      return materials.slab;
    case 'roof':
      return materials.roof;
    case 'window':
      return materials.window;
    case 'door':
      return materials.door;
    case 'beam':
      return materials.beam;
    case 'column':
      return materials.column;
    case 'railing':
      return materials.railing;
    case 'stair':
      return materials.stair;
    case 'curtainWall':
      return materials.curtainWall;
    case 'covering':
      return materials.covering;
    case 'footing':
      return materials.footing;
    case 'plate':
      return materials.plate;
    case 'member':
      return materials.member;
    case 'furniture':
      return materials.furniture;
    case 'opening':
      return materials.opening;
    default:
      return materials.unknown;
  }
}

/**
 * Dispose all materials and their textures.
 */
export function disposeBimMaterials(materials: BimMaterialSet): void {
  for (const mat of Object.values(materials)) {
    if (mat && typeof mat === 'object' && 'dispose' in mat) {
      const m = mat as InstanceType<ThreeNS['MeshStandardMaterial']>;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  }
}
