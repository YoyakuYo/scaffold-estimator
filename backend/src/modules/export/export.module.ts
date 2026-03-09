import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { PDFGeneratorService } from './pdf-generator.service';
import { ExcelGeneratorService } from './excel-generator.service';
import { EstimateTemplateService } from './estimate-template.service';

@Module({
  imports: [],
  controllers: [ExportController],
  providers: [
    ExportService,
    PDFGeneratorService,
    ExcelGeneratorService,
    EstimateTemplateService,
  ],
  exports: [ExportService],
})
export class ExportModule {}
