import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { CalculatedQuantity } from './calculated-quantity.entity';
import { ScaffoldMaterial } from './scaffold-material.entity';
import { ScaffoldConfigController } from './scaffold-config.controller';
import { ScaffoldConfigService } from './scaffold-config.service';
import { ScaffoldCalculatorService } from './scaffold-calculator.service';
import { ScaffoldCalculatorWakugumiService } from './scaffold-calculator-wakugumi.service';
import { ScaffoldExcelService } from './scaffold-excel.service';
import { ScaffoldPdfService } from './scaffold-pdf.service';
import { ScaffoldCadService } from './scaffold-cad.service';
import { PriceTableParserService } from './price-table-parser.service';
import { PolygonToWallsService } from './polygon-to-walls.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScaffoldConfiguration, CalculatedQuantity, ScaffoldMaterial]),
  ],
  controllers: [ScaffoldConfigController],
  providers: [
    ScaffoldConfigService,
    ScaffoldCalculatorService,
    ScaffoldCalculatorWakugumiService,
    ScaffoldExcelService,
    ScaffoldPdfService,
    ScaffoldCadService,
    PriceTableParserService,
    PolygonToWallsService,
  ],
  exports: [ScaffoldConfigService],
})
export class ScaffoldConfigModule {}
