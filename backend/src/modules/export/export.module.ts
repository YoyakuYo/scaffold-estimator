import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { PDFGeneratorService } from './pdf-generator.service';
import { ExcelGeneratorService } from './excel-generator.service';
import { EstimateTemplateService } from './estimate-template.service';
import { EstimateExport } from './estimate-export.entity';
import { Estimate } from '../estimate/estimate.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EstimateExport, Estimate])],
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
