import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { VisionAnalysisService } from './vision-analysis.service';
import { ChatAssistantService } from './chat-assistant.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { ChatRequestDto, VisionAnalyzeDto, AnomalyDetectDto } from './dto/ai.dto';
import { ScaffoldConfigService } from '../scaffold-config/scaffold-config.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private aiService: AiService,
    private visionService: VisionAnalysisService,
    private chatService: ChatAssistantService,
    private anomalyService: AnomalyDetectionService,
    private configService: ScaffoldConfigService,
  ) {}

  /**
   * GET /api/v1/ai/status
   * Check if AI features are available.
   */
  @Get('status')
  getStatus() {
    return {
      available: this.aiService.isAvailable(),
      model: this.aiService.isAvailable() ? this.aiService.getModel() : null,
      features: {
        vision: this.aiService.isAvailable(),
        chat: this.aiService.isAvailable(),
        anomalyDetection: true, // Rule-based always works, AI enhances it
      },
    };
  }

  /**
   * POST /api/v1/ai/vision/analyze
   * Analyze a drawing image using OpenAI Vision (base64 upload).
   */
  @Post('vision/analyze')
  async analyzeDrawingBase64(@Body() dto: VisionAnalyzeDto) {
    this.logger.log('Vision analysis requested (base64)');
    return this.visionService.analyzeDrawingBase64(dto.image, dto.mimeType || 'image/jpeg');
  }

  /**
   * POST /api/v1/ai/vision/analyze-file
   * Analyze an uploaded drawing file using OpenAI Vision.
   */
  @Post('vision/analyze-file')
  @UseInterceptors(FileInterceptor('file', {
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  }))
  async analyzeDrawingFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return { success: false, error: 'No file uploaded' };
    }
    this.logger.log(`Vision analysis requested for file: ${file.originalname}`);
    return this.visionService.analyzeDrawing(file.path);
  }

  /**
   * POST /api/v1/ai/chat
   * Chat with the AI scaffold estimation assistant.
   */
  @Post('chat')
  async chat(@Body() dto: ChatRequestDto) {
    this.logger.log(`Chat message: "${dto.message.substring(0, 50)}..."`);

    let context: any = {};

    // Load current config context if provided
    if (dto.currentConfigId) {
      try {
        const config = await this.configService.getConfig(dto.currentConfigId);
        context.currentConfig = config;
      } catch {
        // Config not found, continue without context
      }
    }

    // Load recent configs for context
    try {
      const recentConfigs = await this.configService.listConfigs();
      context.recentConfigs = recentConfigs?.slice(0, 5);
    } catch {
      // Continue without recent configs
    }

    return this.chatService.chat(
      dto.message,
      dto.history || [],
      context,
    );
  }

  /**
   * POST /api/v1/ai/anomaly-detect
   * Run anomaly detection on a scaffold configuration's quantities.
   */
  @Post('anomaly-detect')
  async detectAnomalies(@Body() dto: AnomalyDetectDto) {
    this.logger.log(`Anomaly detection requested for config: ${dto.configId}`);

    const config = await this.configService.getConfig(dto.configId);
    if (!config) {
      return { success: false, error: 'Configuration not found' };
    }

    const quantities = await this.configService.getQuantities(dto.configId);
    if (!quantities || quantities.length === 0) {
      return { success: false, error: 'No quantities found. Calculate first.' };
    }

    return this.anomalyService.detectAnomalies(
      {
        scaffoldType: config.scaffoldType || 'kusabi',
        buildingHeightMm: config.buildingHeightMm,
        scaffoldWidthMm: config.scaffoldWidthMm,
        walls: config.walls,
      },
      quantities.map(q => ({
        componentType: q.componentType,
        componentName: q.componentName,
        sizeSpec: q.sizeSpec,
        calculatedQuantity: q.calculatedQuantity,
        adjustedQuantity: q.adjustedQuantity ?? undefined,
        unit: q.unit,
      })),
      config.calculationResult,
    );
  }
}
