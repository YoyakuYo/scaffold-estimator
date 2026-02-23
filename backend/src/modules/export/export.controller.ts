import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExportService } from './export.service';

@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('estimates/:estimateId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'estimator')
  async generateExport(
    @Param('estimateId') estimateId: string,
    @Query('format') format: 'pdf' | 'excel',
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportEstimate(
      estimateId,
      format || 'pdf',
      user.id,
    );

    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  }

  @Get(':exportId')
  async downloadExport(
    @Param('exportId') exportId: string,
    @Res() res: Response,
  ) {
    const export_ = await this.exportService.getExport(exportId);

    // In production, this would stream from S3 or local storage
    res.setHeader('Content-Type', export_.exportFormat === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="estimate-${export_.estimateId}.${export_.exportFormat}"`);
    
    // For now, return the export record info
    // In production, would fetch and stream the actual file
    res.json(export_);
  }
}
