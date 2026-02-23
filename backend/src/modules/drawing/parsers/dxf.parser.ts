import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DxfParser = require('dxf-parser');

@Injectable()
export class DxfParsingService {
  private readonly logger = new Logger(DxfParsingService.name);

  async extract(filePath: string): Promise<any> {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const parser = new DxfParser();
      const dxf = parser.parse(fileContent);

      return {
        id: Math.random().toString(36).substring(7),
        fileId: filePath,
        elements: this.extractElements(dxf),
        boundingBox: this.calculateBoundingBox(dxf),
        scale: this.extractScale(dxf),
        unit: dxf?.header?.headerVars?.$MEASUREMENT === 0 ? 'mm' : 'cm',
        layers: dxf?.tables?.layer?.layers?.map((l: any) => ({
          name: l.name,
          color: l.color,
        })) || [],
      };
    } catch (error: any) {
      this.logger.error(`DXF parsing failed: ${error.message}`);
      throw error;
    }
  }

  private extractElements(dxf: any): any[] {
    const elements: any[] = [];

    if (!dxf?.entities || !Array.isArray(dxf.entities)) {
      return elements;
    }

    dxf.entities.forEach((entity: any) => {
      try {
        switch (entity.type) {
          case 'LINE':
            elements.push({
              type: 'line',
              coordinates: [
                [entity.start.x, entity.start.y],
                [entity.end.x, entity.end.y],
              ],
              layer: entity.layer || 'default',
              extracted: {
                length: Math.hypot(
                  entity.end.x - entity.start.x,
                  entity.end.y - entity.start.y,
                ),
              },
            });
            break;
          case 'LWPOLYLINE':
          case 'POLYLINE':
            const vertices = entity.vertices || entity.points || [];
            if (vertices.length > 0) {
              elements.push({
                type: 'polyline',
                coordinates: vertices.map((v: any) => [v.x || v[0], v.y || v[1]]),
                layer: entity.layer || 'default',
                extracted: {
                  area: this.calculatePolygonArea(vertices),
                  perimeter: this.calculatePerimeter(vertices),
                },
              });
            }
            break;
          case 'CIRCLE':
            elements.push({
              type: 'circle',
              coordinates: [[entity.center.x, entity.center.y]],
              layer: entity.layer || 'default',
              properties: { radius: entity.radius },
              extracted: {
                area: Math.PI * entity.radius ** 2,
              },
            });
            break;
          case 'ARC':
            elements.push({
              type: 'arc',
              coordinates: [[entity.center.x, entity.center.y]],
              layer: entity.layer || 'default',
              properties: {
                radius: entity.radius,
                startAngle: entity.startAngle,
                endAngle: entity.endAngle,
              },
            });
            break;
          case 'TEXT':
          case 'MTEXT':
            elements.push({
              type: 'text',
              coordinates: [[entity.position?.x || 0, entity.position?.y || 0]],
              layer: entity.layer || 'default',
              properties: { text: entity.text || entity.string || '' },
            });
            break;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to extract entity: ${err.message}`);
      }
    });

    return elements;
  }

  private calculateBoundingBox(dxf: any): any {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    if (dxf?.entities && Array.isArray(dxf.entities)) {
      dxf.entities.forEach((entity: any) => {
        if (entity.start) {
          minX = Math.min(minX, entity.start.x);
          maxX = Math.max(maxX, entity.start.x);
          minY = Math.min(minY, entity.start.y);
          maxY = Math.max(maxY, entity.start.y);
        }
        if (entity.end) {
          minX = Math.min(minX, entity.end.x);
          maxX = Math.max(maxX, entity.end.x);
          minY = Math.min(minY, entity.end.y);
          maxY = Math.max(maxY, entity.end.y);
        }
        if (entity.center) {
          const radius = entity.radius || 0;
          minX = Math.min(minX, entity.center.x - radius);
          maxX = Math.max(maxX, entity.center.x + radius);
          minY = Math.min(minY, entity.center.y - radius);
          maxY = Math.max(maxY, entity.center.y + radius);
        }
      });
    }

    if (!isFinite(minX)) {
      return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    }

    return { minX, minY, maxX, maxY };
  }

  private extractScale(dxf: any): number {
    // Try to find scale from DXF header or layout
    const scale = dxf?.header?.headerVars?.$SCALE || 1;
    return scale;
  }

  private calculatePolygonArea(vertices: any[]): number {
    if (vertices.length < 3) return 0;
    // Shoelace formula
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const xi = vertices[i].x || vertices[i][0] || 0;
      const yi = vertices[i].y || vertices[i][1] || 0;
      const xj = vertices[j].x || vertices[j][0] || 0;
      const yj = vertices[j].y || vertices[j][1] || 0;
      area += xi * yj;
      area -= xj * yi;
    }
    return Math.abs(area) / 2;
  }

  private calculatePerimeter(vertices: any[]): number {
    if (vertices.length < 2) return 0;
    let perimeter = 0;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      const xi = vertices[i].x || vertices[i][0] || 0;
      const yi = vertices[i].y || vertices[i][1] || 0;
      const xj = vertices[j].x || vertices[j][0] || 0;
      const yj = vertices[j].y || vertices[j][1] || 0;
      perimeter += Math.hypot(xj - xi, yj - yi);
    }
    return perimeter;
  }
}
