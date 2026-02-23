import { ScaffoldingCalculationStrategy, BillOfMaterials, ComponentQuantity } from './calculation.strategy';
import { NormalizedGeometry } from '../../drawing/interfaces/normalized-geometry.interface';

export class S造Strategy extends ScaffoldingCalculationStrategy {
  calculateMaterials(geometry: NormalizedGeometry): BillOfMaterials {
    const area = this.calculateArea(geometry);
    const height = this.calculateHeight(geometry);

    // S-structure: 2.0m standard intervals (larger spans possible)
    const frameSpacing = 2.0; // meters
    const framesRequired = Math.ceil(area / (frameSpacing * frameSpacing));
    const verticalIntervals = Math.ceil(height / 2.0);

    const components: ComponentQuantity[] = [
      {
        componentId: 'frame-1500x2000',
        componentName: 'クサビ式足場フレーム 1500×2000',
        quantity: Math.ceil(framesRequired * verticalIntervals * 0.9), // 10% less than renovation
        unit: 'piece',
        unitPrice: 2500,
        manualOverride: false,
      },
      {
        componentId: 'beam-3000',
        componentName: '足場板 3000mm',
        quantity: framesRequired * verticalIntervals * 1.8,
        unit: 'piece',
        unitPrice: 800,
        manualOverride: false,
      },
      {
        componentId: 'brace',
        componentName: '筋交い 2000mm',
        quantity: framesRequired * verticalIntervals * 1.2,
        unit: 'piece',
        unitPrice: 600,
        manualOverride: false,
      },
      {
        componentId: 'platform-mesh',
        componentName: '足場板メッシュ',
        quantity: Math.ceil(area / 2.5), // Larger platforms possible
        unit: 'piece',
        unitPrice: 1200,
        manualOverride: false,
      },
      {
        componentId: 'safety-net',
        componentName: '安全ネット',
        quantity: Math.ceil(area),
        unit: 'm²',
        unitPrice: 500,
        manualOverride: false,
      },
      {
        componentId: 'base-jack',
        componentName: 'ベースジャッキ',
        quantity: Math.ceil(this.calculatePerimeter(geometry) / 3.5),
        unit: 'piece',
        unitPrice: 1500,
        manualOverride: false,
      },
      {
        componentId: 'anchor-point',
        componentName: 'アンカーポイント',
        quantity: Math.ceil(this.calculatePerimeter(geometry) / 6.0),
        unit: 'piece',
        unitPrice: 2000,
        manualOverride: false,
      },
    ];

    return {
      scaffoldingType: 'vertical',
      components,
      totalArea: area,
      totalHeight: height,
      estimatedWeight: this.calculateWeight(components),
      adjustmentCoefficient: 1.0,
      confidence: 0.85,
      manualOverrides: new Map(),
    };
  }

  getComponentQuantities(): ComponentQuantity[] {
    return [];
  }

  calculateArea(geometry: NormalizedGeometry): number {
    return this.calculateBoundingBoxArea(geometry);
  }

  calculateHeight(geometry: NormalizedGeometry): number {
    const height = this.estimateHeightFromGeometry(geometry);
    return height || 12; // Default 12m for steel
  }

  private calculateWeight(components: ComponentQuantity[]): number {
    const weights: Record<string, number> = {
      'frame-1500x2000': 15,
      'beam-3000': 8,
      'brace': 5,
      'platform-mesh': 3,
      'safety-net': 0.5,
      'base-jack': 2,
      'anchor-point': 1,
    };

    return components.reduce((total, comp) => {
      const unitWeight = weights[comp.componentId] || 1;
      return total + comp.quantity * unitWeight;
    }, 0);
  }
}
