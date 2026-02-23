import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Drawing } from '../drawing.entity';
import { DrawingParsingService } from '../parsers/drawing-parsing.service';
import { DrawingFileFormat } from '../drawing.entity';

@Processor('drawing-processing')
export class DrawingProcessor {
  private readonly logger = new Logger(DrawingProcessor.name);

  constructor(
    @InjectRepository(Drawing)
    private drawingRepository: Repository<Drawing>,
    private parsingService: DrawingParsingService,
  ) {}

  @Process('parse')
  async handleDrawingParse(job: Job<{ drawingId: string; filePath: string; format: DrawingFileFormat }>) {
    const { drawingId, filePath, format } = job.data;

    this.logger.log(`Processing drawing ${drawingId}`);

    try {
      // Update status to processing
      await this.drawingRepository.update(drawingId, {
        uploadStatus: 'processing',
      });

      // Parse the drawing
      const normalizedGeometry = await this.parsingService.parse(filePath, format);

      // Update drawing with parsed data
      await this.drawingRepository.update(drawingId, {
        normalizedGeometry: normalizedGeometry as any,
        detectedStructureType: normalizedGeometry.detectedStructureType,
        uploadStatus: 'completed',
        metadata: {
          scale: normalizedGeometry.scale,
          unit: normalizedGeometry.unit,
          bbox: normalizedGeometry.boundingBox,
          layers: normalizedGeometry.layers.map((l) => l.name),
        },
      });

      this.logger.log(`Drawing ${drawingId} processed successfully`);
    } catch (error) {
      this.logger.error(`Failed to process drawing ${drawingId}:`, error);
      await this.drawingRepository.update(drawingId, {
        uploadStatus: 'failed',
      });
      throw error;
    }
  }
}
