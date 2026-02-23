export interface NormalizedGeometry {
  id: string;
  fileId: string;
  elements: GeometryElement[];
  boundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  scale: number; // pixels/mm ratio
  unit: 'mm' | 'cm' | 'm';
  layers: LayerMetadata[];
  detectedStructureType: '改修工事' | 'S造' | 'RC造';
  /** Raw text content extracted from PDF or CAD file (for dimension parsing) */
  text?: string;
}

export interface GeometryElement {
  id: string;
  type: 'line' | 'polyline' | 'arc' | 'circle' | 'polygon' | 'text' | 'dimension';
  coordinates: number[][]; // array of [x, y] points
  layer: string;
  properties: Record<string, any>;
  extracted?: {
    length?: number;
    area?: number;
    perimeter?: number;
  };
}

export interface LayerMetadata {
  name: string;
  color?: string;
  lineType?: string;
  visible?: boolean;
}
