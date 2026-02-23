import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EstimateController } from './estimate.controller';
import { EstimateService } from './estimate.service';
import { Estimate } from './estimate.entity';
import { DrawingModule } from '../drawing/drawing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Estimate]),
    DrawingModule,
  ],
  controllers: [EstimateController],
  providers: [EstimateService],
  exports: [EstimateService],
})
export class EstimateModule {}
