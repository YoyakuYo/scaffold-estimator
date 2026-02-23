import { Injectable, Logger } from '@nestjs/common';
import { NormalizedGeometry, GeometryElement } from '../interfaces/normalized-geometry.interface';
import { DrawingFileFormat } from '../drawing.entity';

@Injectable()
export class GeometryNormalizerService {
  private readonly logger = new Logger(GeometryNormalizerService.name);

  async normalize(rawData: any, format: DrawingFileFormat): Promise<NormalizedGeometry> {
    // Convert parser output to NormalizedGeometry
    const normalized: NormalizedGeometry = {
      id: rawData.id || Math.random().toString(36).substring(7),
      fileId: rawData.fileId,
      elements: this.normalizeElements(rawData.elements || []),
      boundingBox: rawData.boundingBox || {
        minX: 0,
        minY: 0,
        maxX: 1000,
        maxY: 1000,
      },
      scale: rawData.scale || 1,
      unit: rawData.unit || 'mm',
      layers: rawData.layers || [],
      detectedStructureType: this.detectStructureType(rawData),
      text: rawData.text || undefined,
    };

    return normalized;
  }

  detectStructureType(data: any): '改修工事' | 'S造' | 'RC造' {
    // Pattern matching on layer names and geometry
    const layerNames = (data.layers || []).map((l: any) =>
      l.name?.toLowerCase() || '',
    );

    if (
      layerNames.some(
        (n: string) => n.includes('鉄骨') || n.includes('steel') || n.includes('s造'),
      )
    ) {
      return 'S造';
    } else if (
      layerNames.some(
        (n: string) =>
          n.includes('rc') ||
          n.includes('concrete') ||
          n.includes('rc造') ||
          n.includes('コンクリート'),
      )
    ) {
      return 'RC造';
    } else {
      return '改修工事'; // Default to most complex
    }
  }

  private normalizeElements(elements: any[]): GeometryElement[] {
    return elements.map((el) => ({
      id: el.id || Math.random().toString(36).substring(7),
      type: el.type,
      coordinates: el.coordinates || [],
      layer: el.layer || 'default',
      properties: el.properties || {},
      extracted: el.extracted || {},
    }));
  }
}
