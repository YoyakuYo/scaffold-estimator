import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionActiveGuard } from '../../common/guards/subscription-active.guard';
import { VisionBimService, VisionFootprintResult } from './vision-bim.service';
import { SupabaseService } from '../supabase/supabase.service';
import { v4 as uuid } from 'uuid';

@Controller('vision-bim')
@UseGuards(JwtAuthGuard, SubscriptionActiveGuard)
export class VisionBimController {
  constructor(
    private readonly visionBim: VisionBimService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * POST /vision-bim/analyze
   * Accepts image, DXF, DWG, JWW, IFC, or PDF. Returns structured footprint JSON.
   */
  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async analyze(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<VisionFootprintResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content');
    const filename = file.originalname;
    try {
      return await this.visionBim.processFile(buffer, filename);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'File processing failed');
    }
  }

  /**
   * POST /vision-bim/from-ifc
   * Dedicated IFC (BIM) endpoint — accepts .ifc files up to 50 MB.
   */
  @Post('from-ifc')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async fromIfc(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<VisionFootprintResult> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buffer = (file as any).buffer as Buffer | undefined;
    if (!buffer?.length) throw new BadRequestException('File has no content');
    const ext = file.originalname?.toLowerCase()?.endsWith('.ifc');
    if (!ext) {
      throw new BadRequestException('Only .ifc files are accepted on this endpoint');
    }
    try {
      const result = await this.visionBim.processIfc(buffer);

      // Store IFC file in Supabase storage for frontend 3D rendering
      try {
        const client = this.supabase.getClient();
        const storagePath = `ifc-uploads/${uuid()}.ifc`;
        const { error: uploadError } = await client.storage
          .from('drawings')
          .upload(storagePath, buffer, { contentType: 'application/octet-stream', upsert: true });
        if (!uploadError) {
          const { data: urlData } = client.storage.from('drawings').getPublicUrl(storagePath);
          if (urlData?.publicUrl) {
            result.ifcFileUrl = urlData.publicUrl;
          }
        }
      } catch {
        // Storage upload is best-effort; don't fail the whole request
      }

      return result;
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'IFC processing failed');
    }
  }
}
