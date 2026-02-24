import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * CAD File Converter — DWG/JWW → DXF
 *
 * Accepts DXF (passthrough), DWG, JWW.
 * Converts DWG/JWW to DXF server-side before processing.
 */
@Injectable()
export class CadConverterService {
  private readonly logger = new Logger(CadConverterService.name);

  /**
   * Ensure the file is DXF. If DWG or JWW, convert to DXF first.
   * Returns the path to a valid DXF file.
   */
  async ensureDxf(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.dxf') {
      this.logger.log(`File is already DXF: ${filePath}`);
      return filePath;
    }

    if (ext === '.dwg') {
      return this.convertDwgToDxf(filePath);
    }

    if (ext === '.jww') {
      return this.convertJwwToDxf(filePath);
    }

    throw new BadRequestException(
      `Unsupported CAD format: ${ext}. Only DXF, DWG, and JWW are accepted.`,
    );
  }

  /**
   * Validate that a file has an acceptable CAD extension.
   */
  validateCadExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.dxf', '.dwg', '.jww'].includes(ext);
  }

  // ── DWG → DXF ──────────────────────────────────────────

  private async convertDwgToDxf(dwgPath: string): Promise<string> {
    const dxfPath = dwgPath.replace(/\.dwg$/i, '.dxf');
    this.logger.log(`Converting DWG → DXF: ${dwgPath} → ${dxfPath}`);

    // Strategy 1: Try ODA File Converter (most reliable)
    try {
      return await this.convertWithOda(dwgPath, dxfPath);
    } catch {
      this.logger.warn('ODA File Converter not available, trying libredwg...');
    }

    // Strategy 2: Try libredwg (dwg2dxf)
    try {
      return await this.convertWithLibredwg(dwgPath, dxfPath);
    } catch {
      this.logger.warn('libredwg (dwg2dxf) not available');
    }

    // Strategy 3: Try the dxf-parser npm package to read DWG directly
    // (dxf-parser only handles DXF, so this won't work for DWG)
    throw new BadRequestException(
      'DWG形式はサーバーで変換できません。DXF形式でエクスポートしてからアップロードしてください。 / ' +
      'DWG format cannot be converted on this server. Please export as DXF before uploading.',
    );
  }

  private async convertWithOda(dwgPath: string, dxfPath: string): Promise<string> {
    const inputDir = path.dirname(dwgPath);
    const outputDir = path.dirname(dxfPath);

    // ODA File Converter command-line syntax:
    // ODAFileConverter "InputFolder" "OutputFolder" ACAD2018 DXF 0 1 "*.dwg"
    const odaPaths = [
      'ODAFileConverter',
      'C:\\Program Files\\ODA\\ODAFileConverter\\ODAFileConverter.exe',
      '/usr/bin/ODAFileConverter',
      '/usr/local/bin/ODAFileConverter',
    ];

    for (const odaPath of odaPaths) {
      try {
        await execFileAsync(odaPath, [
          inputDir, outputDir, 'ACAD2018', 'DXF', '0', '1',
          path.basename(dwgPath),
        ], { timeout: 60000 });

        // Check if output file was created
        await fs.access(dxfPath);
        this.logger.log(`ODA conversion successful: ${dxfPath}`);
        return dxfPath;
      } catch {
        continue;
      }
    }

    throw new Error('ODA File Converter not found');
  }

  private async convertWithLibredwg(dwgPath: string, dxfPath: string): Promise<string> {
    const toolPaths = ['dwg2dxf', '/usr/bin/dwg2dxf', '/usr/local/bin/dwg2dxf'];

    for (const toolPath of toolPaths) {
      try {
        await execFileAsync(toolPath, ['-o', dxfPath, dwgPath], {
          timeout: 60000,
        });
        await fs.access(dxfPath);
        this.logger.log(`libredwg conversion successful: ${dxfPath}`);
        return dxfPath;
      } catch {
        continue;
      }
    }

    throw new Error('libredwg (dwg2dxf) not found');
  }

  // ── JWW → DXF ──────────────────────────────────────────

  private async convertJwwToDxf(jwwPath: string): Promise<string> {
    const dxfPath = jwwPath.replace(/\.jww$/i, '.dxf');
    this.logger.log(`Converting JWW → DXF: ${jwwPath} → ${dxfPath}`);

    // JWW is a proprietary Jw_cad format
    // Strategy: Try JWtoDXF or any available converter
    const toolPaths = ['JWtoDXF', 'jwtodxf', '/usr/local/bin/jwtodxf'];

    for (const toolPath of toolPaths) {
      try {
        await execFileAsync(toolPath, [jwwPath, dxfPath], {
          timeout: 60000,
        });
        await fs.access(dxfPath);
        this.logger.log(`JWW conversion successful: ${dxfPath}`);
        return dxfPath;
      } catch {
        continue;
      }
    }

    throw new BadRequestException(
      'JWW conversion requires a JWW-to-DXF converter to be installed on the server. ' +
      'Please convert the file to DXF format before uploading using Jw_cad or a compatible tool.',
    );
  }
}
