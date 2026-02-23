import { ScaffoldingCalculationStrategy } from './calculation.strategy';
import { RC造Strategy } from './rc-zou.strategy';
import { S造Strategy } from './s-zou.strategy';
import { 改修工事Strategy } from './kaisyu-koji.strategy';
import { StructureType } from '../../drawing/drawing.entity';

export class CalculationStrategyFactory {
  static create(structureType: StructureType): ScaffoldingCalculationStrategy {
    switch (structureType) {
      case 'RC造':
        return new RC造Strategy();
      case 'S造':
        return new S造Strategy();
      case '改修工事':
        return new 改修工事Strategy();
      default:
        throw new Error(`Unknown structure type: ${structureType}`);
    }
  }
}
