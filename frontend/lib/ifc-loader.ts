import * as WebIFC from 'web-ifc';

export interface IfcMeshData {
  vertices: Float32Array;
  indices: Uint32Array;
  color: { r: number; g: number; b: number; a: number };
}

let ifcApiInstance: WebIFC.IfcAPI | null = null;

async function getIfcApi(): Promise<WebIFC.IfcAPI> {
  if (ifcApiInstance) return ifcApiInstance;
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath('/');
  await api.Init();
  ifcApiInstance = api;
  return api;
}

/**
 * Parse an IFC file buffer and extract mesh data for Three.js rendering.
 * Returns an array of mesh objects with vertices (position+normal), indices, and color.
 */
export async function parseIfcToMeshes(arrayBuffer: ArrayBuffer): Promise<IfcMeshData[]> {
  const api = await getIfcApi();
  const data = new Uint8Array(arrayBuffer);
  const modelID = api.OpenModel(data);
  const meshes: IfcMeshData[] = [];

  try {
    api.StreamAllMeshes(modelID, (mesh: any) => {
      const placedGeo = mesh.geometries;
      for (let i = 0; i < placedGeo.size(); i++) {
        const pg = placedGeo.get(i);
        const geoData = api.GetGeometry(modelID, pg.geometryExpressID);
        const vData = api.GetVertexArray(geoData.GetVertexData(), geoData.GetVertexDataSize());
        const iData = api.GetIndexArray(geoData.GetIndexData(), geoData.GetIndexDataSize());

        const flatMatrix = pg.flatTransformation;
        const transformedVerts = applyTransform(vData, flatMatrix);

        meshes.push({
          vertices: transformedVerts,
          indices: new Uint32Array(iData),
          color: {
            r: pg.color.x,
            g: pg.color.y,
            b: pg.color.z,
            a: pg.color.w,
          },
        });

        geoData.delete();
      }
    });
  } finally {
    api.CloseModel(modelID);
  }

  return meshes;
}

function applyTransform(vertices: Float32Array, matrix: number[]): Float32Array {
  const result = new Float32Array(vertices.length);
  const stride = 6; // x, y, z, nx, ny, nz per vertex
  const count = vertices.length / stride;

  for (let v = 0; v < count; v++) {
    const base = v * stride;
    const x = vertices[base];
    const y = vertices[base + 1];
    const z = vertices[base + 2];
    const nx = vertices[base + 3];
    const ny = vertices[base + 4];
    const nz = vertices[base + 5];

    // Apply 4x4 column-major transform to position
    result[base]     = matrix[0] * x + matrix[4] * y + matrix[8] * z  + matrix[12];
    result[base + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z  + matrix[13];
    result[base + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];

    // Apply rotation (upper-left 3x3) to normals
    result[base + 3] = matrix[0] * nx + matrix[4] * ny + matrix[8] * nz;
    result[base + 4] = matrix[1] * nx + matrix[5] * ny + matrix[9] * nz;
    result[base + 5] = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz;
  }

  return result;
}
