import { Module } from '@nestjs/common';
import { BimModule } from '../bim/bim.module';
import { StructuralBimController } from './structural-bim.controller';
import { StructuralBimService } from './structural-bim.service';

@Module({
  imports: [BimModule],
  controllers: [StructuralBimController],
  providers: [StructuralBimService],
  exports: [StructuralBimService],
})
export class StructuralBimModule {}
