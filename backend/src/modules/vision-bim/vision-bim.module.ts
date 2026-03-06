import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VisionBimController } from './vision-bim.controller';
import { VisionBimService } from './vision-bim.service';

@Module({
  imports: [ConfigModule],
  controllers: [VisionBimController],
  providers: [VisionBimService],
  exports: [VisionBimService],
})
export class VisionBimModule {}
