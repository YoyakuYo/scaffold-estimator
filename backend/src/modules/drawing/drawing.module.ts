import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { DrawingController } from './drawing.controller';
import { DrawingService } from './drawing.service';
import { DrawingParsingService } from './parsers/drawing-parsing.service';
import { ImageDimensionExtractorService } from './parsers/image-dimension-extractor.service';
import { Drawing } from './drawing.entity';
import { GeometryElement } from './geometry-element.entity';
import { DxfParsingService } from './parsers/dxf.parser';
import { PdfParsingService } from './parsers/pdf.parser';
import { GeometryNormalizerService } from './parsers/geometry.normalizer';
import { BuildingOutlineDetectorService } from './parsers/building-outline-detector.service';
import { DrawingProcessor } from './processors/drawing.processor';
// CAD Professional Pipeline services
import { CadConverterService } from './parsers/cad-converter.service';
import { DxfGeometryExtractorService } from './parsers/dxf-geometry-extractor.service';
import { GeometryCleanerService } from './parsers/geometry-cleaner.service';
import { OuterBoundaryDetectorService } from './parsers/outer-boundary-detector.service';
import { WallSegmentExtractorService } from './parsers/wall-segment-extractor.service';
import { CadProcessingPipelineService } from './parsers/cad-processing-pipeline.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Drawing, GeometryElement]),
    BullModule.registerQueue({
      name: 'drawing-processing',
    }),
  ],
  controllers: [DrawingController],
  providers: [
    DrawingService,
    DrawingParsingService,
    ImageDimensionExtractorService,
    DxfParsingService,
    PdfParsingService,
    GeometryNormalizerService,
    BuildingOutlineDetectorService,
    DrawingProcessor,
    // CAD Professional Pipeline
    CadConverterService,
    DxfGeometryExtractorService,
    GeometryCleanerService,
    OuterBoundaryDetectorService,
    WallSegmentExtractorService,
    CadProcessingPipelineService,
  ],
  exports: [DrawingService, CadProcessingPipelineService],
})
export class DrawingModule {}
