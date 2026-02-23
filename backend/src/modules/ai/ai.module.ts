import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { VisionAnalysisService } from './vision-analysis.service';
import { ChatAssistantService } from './chat-assistant.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { AiController } from './ai.controller';
import { ScaffoldConfigModule } from '../scaffold-config/scaffold-config.module';

@Module({
  imports: [ScaffoldConfigModule],
  controllers: [AiController],
  providers: [
    AiService,
    VisionAnalysisService,
    ChatAssistantService,
    AnomalyDetectionService,
  ],
  exports: [AiService, VisionAnalysisService, ChatAssistantService, AnomalyDetectionService],
})
export class AiModule {}
