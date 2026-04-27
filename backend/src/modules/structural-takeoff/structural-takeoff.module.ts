import { Module } from '@nestjs/common';
import { StructuralTakeoffController } from './structural-takeoff.controller';
import { StructuralTakeoffService } from './structural-takeoff.service';
import { ExcelElementImportService } from './extractors/excel-import.service';
import { DxfLayerExtractorService } from './extractors/dxf-layer-extractor.service';
import { TitleBlockVisionService } from './extractors/title-block-vision.service';
import { AiElementVisionService } from './extractors/ai-element-vision.service';
import { ConstructionPlanExcelService } from './schedule/construction-plan-excel.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PresenceModule } from '../presence/presence.module';
import { SubscriptionAiGuard } from '../../common/guards/subscription-ai.guard';

@Module({
  imports: [SubscriptionModule, PresenceModule],
  controllers: [StructuralTakeoffController],
  providers: [
    StructuralTakeoffService,
    ExcelElementImportService,
    DxfLayerExtractorService,
    TitleBlockVisionService,
    AiElementVisionService,
    ConstructionPlanExcelService,
    SubscriptionAiGuard,
  ],
  exports: [StructuralTakeoffService],
})
export class StructuralTakeoffModule {}
