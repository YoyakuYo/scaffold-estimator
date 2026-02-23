import { NormalizedGeometry } from '../../drawing/interfaces/normalized-geometry.interface';

export interface ComponentQuantity {
  componentId: string;
  componentName: string;
  quantity: number;
  unit: 'piece' | 'set' | 'kg' | 'm²' | 'm' | 'ton';
  unitPrice: number;
  manualOverride: boolean;
  overrideReason?: string;
}

export interface BillOfMaterials {
  scaffoldingType: string;
  components: ComponentQuantity[];
  totalArea: number; // m²
  totalHeight: number; // m
  estimatedWeight?: number; // kg
  adjustmentCoefficient: number;
  confidence: number;
  manualOverrides: Map<string, number>;
}

export abstract class ScaffoldingCalculationStrategy {
  abstract calculateMaterials(geometry: NormalizedGeometry): BillOfMaterials;

  abstract getComponentQuantities(): ComponentQuantity[];

  abstract calculateArea(geometry: NormalizedGeometry): number;

  abstract calculateHeight(geometry: NormalizedGeometry): number;

  protected calculateBoundingBoxArea(geometry: NormalizedGeometry): number {
    const { minX, maxX, minY, maxY } = geometry.boundingBox;
    // Convert mm² to m²
    return ((maxX - minX) * (maxY - minY)) / 1_000_000;
  }

  protected calculatePerimeter(geometry: NormalizedGeometry): number {
    // Calculate perimeter from bounding box (simplified)
    const { minX, maxX, minY, maxY } = geometry.boundingBox;
    return ((maxX - minX) + (maxY - minY)) * 2 / 1000; // Convert to meters
  }

  protected estimateHeightFromGeometry(geometry: NormalizedGeometry): number {
    // Look for dimension annotations
    const dimensionElements = geometry.elements.filter(
      (el) => el.type === 'dimension' || el.type === 'text',
    );

    for (const element of dimensionElements) {
      const text = element.properties?.text || '';
      const heightMatch = text.match(/(\d+(?:\.\d+)?)\s*(m|メートル|mm|cm)/i);
      if (heightMatch) {
        let value = parseFloat(heightMatch[1]);
        const unit = heightMatch[2].toLowerCase();
        if (unit === 'mm') value = value / 1000;
        if (unit === 'cm') value = value / 100;
        if (value > 1 && value < 100) {
          // Reasonable height range
          return value;
        }
      }
    }

    // Default fallback
    return 10; // 10 meters
  }
}
