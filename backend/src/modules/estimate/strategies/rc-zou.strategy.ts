import { ScaffoldingCalculationStrategy, BillOfMaterials, ComponentQuantity } from './calculation.strategy';
import { NormalizedGeometry } from '../../drawing/interfaces/normalized-geometry.interface';

export class RC造Strategy extends ScaffoldingCalculationStrategy {
  calculateMaterials(geometry: NormalizedGeometry): BillOfMaterials {
    const area = this.calculateArea(geometry);
    const height = this.calculateHeight(geometry);

    // RC: 2.0m intervals standard
    const frameSpacing = 2.0; // meters
    const framesRequired = Math.ceil(area / (frameSpacing * frameSpacing));
    const verticalIntervals = Math.ceil(height / 2.0);

    const components: ComponentQuantity[] = [
      {
        componentId: 'frame-1500x2000',
        componentName: 'クサビ式足場フレーム 1500×2000',
        quantity: framesRequired * verticalIntervals,
        unit: 'piece',
        unitPrice: 2500,
        manualOverride: false,
      },
      {
        componentId: 'beam-3000',
        componentName: '足場板 3000mm',
        quantity: framesRequired * verticalIntervals * 2,
        unit: 'piece',
        unitPrice: 800,
        manualOverride: false,
      },
      {
        componentId: 'brace',
        componentName: '筋交い 2000mm',
        quantity: framesRequired * verticalIntervals,
        unit: 'piece',
        unitPrice: 600,
        manualOverride: false,
      },
      {
        componentId: 'platform-mesh',
        componentName: '足場板メッシュ',
        quantity: Math.ceil(area / 3.0),
        unit: 'piece',
        unitPrice: 1200,
        manualOverride: false,
      },
      {
        componentId: 'safety-net',
        componentName: '安全ネット',
        quantity: Math.ceil(area * 0.9),
        unit: 'm²',
        unitPrice: 500,
        manualOverride: false,
      },
      {
        componentId: 'base-jack',
        componentName: 'ベースジャッキ',
        quantity: Math.ceil(this.calculatePerimeter(geometry) / 4.0),
        unit: 'piece',
        unitPrice: 1500,
        manualOverride: false,
      },
    ];

    return {
      scaffoldingType: 'vertical',
      components,
      totalArea: area,
      totalHeight: height,
      estimatedWeight: this.calculateWeight(components),
      adjustmentCoefficient: 0.9, // RC is simpler, 10% reduction
      confidence: 0.9,
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
    return this.estimateHeightFromGeometry(geometry);
  }

  private calculateWeight(components: ComponentQuantity[]): number {
    // Approximate weights (kg per unit)
    const weights: Record<string, number> = {
      'frame-1500x2000': 15,
      'beam-3000': 8,
      'brace': 5,
      'platform-mesh': 3,
      'safety-net': 0.5,
      'base-jack': 2,
    };

    return components.reduce((total, comp) => {
      const unitWeight = weights[comp.componentId] || 1;
      return total + comp.quantity * unitWeight;
    }, 0);
  }
}
