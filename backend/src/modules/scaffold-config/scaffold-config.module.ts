import { Module } from '@nestjs/common';
import { ScaffoldConfigController } from './scaffold-config.controller';
import { ScaffoldConfigService } from './scaffold-config.service';
import { ScaffoldCalculatorService } from './scaffold-calculator.service';
import { ScaffoldCalculatorWakugumiService } from './scaffold-calculator-wakugumi.service';
import { ScaffoldExcelService } from './scaffold-excel.service';
import { ScaffoldPdfService } from './scaffold-pdf.service';
import { ScaffoldCadService } from './scaffold-cad.service';
import { PolygonToWallsService } from './polygon-to-walls.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';

@Module({
  imports: [SubscriptionModule],
  controllers: [ScaffoldConfigController],
  providers: [
    ScaffoldConfigService,
    ScaffoldCalculatorService,
    ScaffoldCalculatorWakugumiService,
    ScaffoldExcelService,
    ScaffoldPdfService,
    ScaffoldCadService,
    PolygonToWallsService,
    SubscriptionActiveGuard,
  ],
  exports: [ScaffoldConfigService],
})
export class ScaffoldConfigModule {}
