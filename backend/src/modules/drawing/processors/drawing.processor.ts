import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { DrawingParsingService } from '../parsers/drawing-parsing.service';
import { DrawingFileFormat } from '../drawing.entity';
import { SupabaseService } from '../../supabase/supabase.service';
import { mapPayloadToSnake } from '../../../common/utils/db-mapper';

@Processor('drawing-processing')
export class DrawingProcessor {
  private readonly logger = new Logger(DrawingProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private parsingService: DrawingParsingService,
  ) {}

  @Process('parse')
  async handleDrawingParse(job: Job<{ drawingId: string; filePath: string; format: DrawingFileFormat }>) {
    const { drawingId, filePath, format } = job.data;
    const client = this.supabase.getClient();

    this.logger.log(`Processing drawing ${drawingId}`);

    try {
      await client.from('drawings').update(mapPayloadToSnake({ uploadStatus: 'processing' })).eq('id', drawingId);

      const normalizedGeometry = await this.parsingService.parse(filePath, format);

      await client.from('drawings').update(
        mapPayloadToSnake({
          normalizedGeometry: normalizedGeometry as any,
          detectedStructureType: normalizedGeometry.detectedStructureType,
          uploadStatus: 'completed',
          metadata: {
            scale: normalizedGeometry.scale,
            unit: normalizedGeometry.unit,
            bbox: normalizedGeometry.boundingBox,
            layers: normalizedGeometry.layers?.map((l: any) => l.name) || [],
          },
        }),
      ).eq('id', drawingId);

      this.logger.log(`Drawing ${drawingId} processed successfully`);
    } catch (error) {
      this.logger.error(`Failed to process drawing ${drawingId}:`, error);
      await client.from('drawings').update(mapPayloadToSnake({ uploadStatus: 'failed' })).eq('id', drawingId);
      throw error;
    }
  }
}
