import { Module } from '@nestjs/common';
import { StructuralTakeoffController } from './structural-takeoff.controller';
import { StructuralTakeoffService } from './structural-takeoff.service';
import { ExcelElementImportService } from './extractors/excel-import.service';
import { DxfLayerExtractorService } from './extractors/dxf-layer-extractor.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [SubscriptionModule, PresenceModule],
  controllers: [StructuralTakeoffController],
  providers: [StructuralTakeoffService, ExcelElementImportService, DxfLayerExtractorService],
  exports: [StructuralTakeoffService],
})
export class StructuralTakeoffModule {}
