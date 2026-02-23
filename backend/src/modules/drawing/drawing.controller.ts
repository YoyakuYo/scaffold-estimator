import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Param,
  Query,
  Res,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DrawingService } from './drawing.service';
import { DrawingFileFormat } from './drawing.entity';

@Controller('drawings')
@UseGuards(JwtAuthGuard)
export class DrawingController {
  private readonly logger = new Logger(DrawingController.name);

  constructor(private readonly drawingService: DrawingService) {}

  @Post('upload')
  @UseGuards(RolesGuard)
  @Roles('admin', 'estimator')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'application/pdf',
          'image/vnd.dxf',
          'application/dxf',
          'application/vnd.dwg',
          'application/acad',
          'application/x-dwg',
          'application/octet-stream', // DWG/JWW files may have generic mime
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/bmp',
          'image/svg+xml',
          'image/tiff',
        ];
        const ext = extname(file.originalname).toLowerCase();
        const allowedExts = [
          '.pdf', '.dxf', '.dwg', '.jww',
          '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff',
        ];
        
        if (!allowedExts.includes(ext)) {
          cb(new BadRequestException('Invalid file format. Accepted formats: PDF, DXF, DWG, JWW, JPG, PNG, GIF, WEBP, BMP, SVG, TIFF.'), false);
        } else if (!allowedMimes.includes(file.mimetype)) {
          // Extension is valid but MIME is unexpected — still allow (CAD files often have generic MIME types)
          cb(null, true);
        } else {
          cb(null, true);
        }
      },
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
    }),
  )
  async uploadDrawing(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
    @Query('projectId') projectId: string,
  ) {
    try {
      if (!file) {
        throw new BadRequestException('No file uploaded');
      }

      if (!projectId) {
        throw new BadRequestException('projectId is required');
      }

      this.logger.log(`Uploading file: ${file.originalname}, size: ${file.size}, format: ${extname(file.originalname)}`);
      
      const result = await this.drawingService.processDrawing(file, projectId, user.id);
      
      this.logger.log(`File uploaded successfully: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Upload failed: ${error.message}`, error.stack);
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // Check for database enum errors
      if (error.message?.includes('invalid input value for enum') || 
          error.message?.includes('drawing_file_format')) {
        throw new BadRequestException(
          'Unsupported file format. Please run the database migration to add image format support.'
        );
      }
      
      throw new InternalServerErrorException(
        `Upload failed: ${error.message || 'Unknown error'}`
      );
    }
  }

  @Get()
  async listDrawings(
    @CurrentUser() user: any,
    @Query('projectId') projectId?: string,
  ) {
    return await this.drawingService.listDrawings(user.companyId, projectId);
  }

  @Get(':id')
  async getDrawing(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.drawingService.getDrawing(id, user.companyId);
  }

  @Get(':id/file')
  async getDrawingFile(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    try {
      const drawing = await this.drawingService.getDrawing(id, user.companyId);
      const filePath = drawing.filePath;
      
      this.logger.log(`Serving file: ${filePath} for drawing ${id}`);
      
      // Check if file exists
      const fs = require('fs');
      const path = require('path');
      const fullPath = path.join(process.cwd(), filePath);
      
      if (!fs.existsSync(fullPath)) {
        this.logger.error(`File not found: ${fullPath}`);
        return res.status(404).json({ message: 'File not found' });
      }
      
      // Set appropriate content type based on file format
      const contentTypeMap: Record<string, string> = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        bmp: 'image/bmp',
        webp: 'image/webp',
        dxf: 'image/vnd.dxf',
        dwg: 'application/vnd.dwg',
      };
      
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const contentType = contentTypeMap[ext] || 'application/octet-stream';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      
      // Serve file from local storage
      // In production, this would stream from S3
      return res.sendFile(fullPath);
    } catch (error) {
      this.logger.error(`Error serving file: ${error.message}`, error.stack);
      return res.status(500).json({ message: 'Failed to serve file' });
    }
  }
}
