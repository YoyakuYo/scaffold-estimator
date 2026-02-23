import { ScaffoldingCalculationStrategy, BillOfMaterials, ComponentQuantity } from './calculation.strategy';
import { NormalizedGeometry } from '../../drawing/interfaces/normalized-geometry.interface';

export class 改修工事Strategy extends ScaffoldingCalculationStrategy {
  calculateMaterials(geometry: NormalizedGeometry): BillOfMaterials {
    const area = this.calculateArea(geometry);
    const height = this.calculateHeight(geometry);
    const perimeter = this.calculatePerimeter(geometry);

    // 改修工事: Most complex - irregular shapes, existing structure adaptation
    // Apply 1.25x complexity multiplier for irregular shapes
    const complexityMultiplier = 1.25;
    const adjustedArea = area * complexityMultiplier;

    // Japanese standard: 改修工事 uses 1.8m horizontal intervals
    const horizontalIntervals = Math.ceil(perimeter / 1.8);
    const verticalIntervals = Math.ceil(height / 2.0);

    const components: ComponentQuantity[] = [
      {
        componentId: 'frame-1500x2000',
        componentName: 'クサビ式足場フレーム 1500×2000',
        quantity: horizontalIntervals * verticalIntervals,
        unit: 'piece',
        unitPrice: 2500,
        manualOverride: false,
      },
      {
        componentId: 'beam-3000',
        componentName: '足場板 3000mm',
        quantity: horizontalIntervals * verticalIntervals * 2,
        unit: 'piece',
        unitPrice: 800,
        manualOverride: false,
      },
      {
        componentId: 'brace',
        componentName: '筋交い 2000mm',
        quantity: Math.ceil(horizontalIntervals * verticalIntervals * 1.5),
        unit: 'piece',
        unitPrice: 600,
        manualOverride: false,
      },
      {
        componentId: 'platform-mesh',
        componentName: '足場板メッシュ',
        quantity: Math.ceil(adjustedArea / 2.0),
        unit: 'piece',
        unitPrice: 1200,
        manualOverride: false,
      },
      {
        componentId: 'safety-net',
        componentName: '安全ネット',
        quantity: Math.ceil(adjustedArea * 1.1), // 10% extra for safety
        unit: 'm²',
        unitPrice: 500,
        manualOverride: false,
      },
      {
        componentId: 'base-jack',
        componentName: 'ベースジャッキ',
        quantity: Math.ceil(perimeter / 3.0),
        unit: 'piece',
        unitPrice: 1500,
        manualOverride: false,
      },
      {
        componentId: 'anchor-point',
        componentName: 'アンカーポイント',
        quantity: Math.ceil(perimeter / 5.0),
        unit: 'piece',
        unitPrice: 2000,
        manualOverride: false,
      },
    ];

    return {
      scaffoldingType: 'mixed',
      components,
      totalArea: adjustedArea,
      totalHeight: height,
      estimatedWeight: this.calculateWeight(components),
      adjustmentCoefficient: 1.25, // 25% complexity buffer for renovations
      confidence: 0.7,
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
