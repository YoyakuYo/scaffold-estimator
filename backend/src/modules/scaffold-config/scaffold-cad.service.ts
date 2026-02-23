import { Injectable, Logger } from '@nestjs/common';
import DxfWriter from 'dxf-writer';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { ScaffoldCalculationResult, WallCalculationResult } from './scaffold-calculator.service';

/**
 * Generates CAD file exports (DXF for 2D, OBJ/STL for 3D).
 */
@Injectable()
export class ScaffoldCadService {
  private readonly logger = new Logger(ScaffoldCadService.name);

  /**
   * Generate DXF file for 2D scaffold drawing
   */
  async generate2DDxf(
    config: ScaffoldConfiguration,
    wallSide?: string,
  ): Promise<Buffer> {
    this.logger.log(`Generating 2D DXF for config ${config.id}, wall: ${wallSide || 'all'}`);

    const result: ScaffoldCalculationResult = config.calculationResult;
    if (!result) {
      throw new Error('No calculation result available');
    }

    const dxf = new DxfWriter();
    dxf.setUnits('Millimeters');

    // Select wall(s) to export
    const wallsToExport = wallSide
      ? result.walls.filter((w) => w.side === wallSide)
      : result.walls;

    for (const wall of wallsToExport) {
      this.addWallToDxf(dxf, wall, result.scaffoldWidthMm);
    }

    const dxfContent = dxf.toDxfString();
    return Buffer.from(dxfContent, 'utf-8');
  }

  /**
   * Add a single wall's scaffold components to DXF
   */
  private addWallToDxf(
    dxf: DxfWriter,
    wall: WallCalculationResult,
    scaffoldWidthMm: number,
  ): void {
    const scale = 1; // 1 unit = 1mm
    const levelHeight = 1800; // 1800mm per level
    const jackHeight = 300; // Approximate jack base height

    // Calculate post positions
    const postX: number[] = [0];
    let currentX = 0;
    for (const span of wall.spans) {
      currentX += span;
      postX.push(currentX);
    }

    // Draw posts (vertical lines)
    for (const x of postX) {
      // Front row
      dxf.drawLine(x * scale, 0, x * scale, (wall.levelCalc.fullLevels * levelHeight + wall.levelCalc.topGuardHeightMm) * scale);
      // Back row
      dxf.drawLine(
        x * scale,
        scaffoldWidthMm * scale,
        x * scale,
        (scaffoldWidthMm + wall.levelCalc.fullLevels * levelHeight + wall.levelCalc.topGuardHeightMm) * scale,
      );
    }

    // Draw horizontal members (yokoji) at each level
    for (let level = 0; level <= wall.levelCalc.fullLevels; level++) {
      const y = jackHeight + level * levelHeight;
      // Span direction (front and back)
      for (let i = 0; i < postX.length - 1; i++) {
        const x1 = postX[i] * scale;
        const x2 = postX[i + 1] * scale;
        dxf.drawLine(x1, y * scale, x2, y * scale); // Front
        dxf.drawLine(x1, (scaffoldWidthMm + y) * scale, x2, (scaffoldWidthMm + y) * scale); // Back
      }
      // Width direction
      for (const x of postX) {
        dxf.drawLine(x * scale, y * scale, x * scale, (scaffoldWidthMm + y) * scale);
      }
    }

    // Draw braces (X-braces) - simplified as diagonal lines
    for (let level = 0; level < wall.levelCalc.fullLevels; level++) {
      const y = jackHeight + level * levelHeight;
      for (let i = 0; i < postX.length - 1; i++) {
        const x1 = postX[i] * scale;
        const x2 = postX[i + 1] * scale;
        const y1 = y * scale;
        const y2 = (y + levelHeight) * scale;
        // X-brace
        dxf.drawLine(x1, y1, x2, y2);
        dxf.drawLine(x1, y2, x2, y1);
      }
    }

    // Add text label
    dxf.drawText(
      (postX[postX.length - 1] / 2) * scale,
      -50 * scale,
      10, // height
      0,  // rotation
      `Wall: ${wall.sideJp}`,
    );
  }

  /**
   * Generate OBJ file for 3D scaffold model
   */
  async generate3DObj(
    config: ScaffoldConfiguration,
    wallSide?: string,
  ): Promise<Buffer> {
    this.logger.log(`Generating 3D OBJ for config ${config.id}, wall: ${wallSide || 'all'}`);

    const result: ScaffoldCalculationResult = config.calculationResult;
    if (!result) {
      throw new Error('No calculation result available');
    }

    const lines: string[] = [];
    lines.push('# Scaffold 3D Model (OBJ format)');
    lines.push(`# Generated for config: ${config.id}`);
    lines.push(`# Wall: ${wallSide || 'all'}`);
    lines.push('');

    let vertexOffset = 0;
    const wallsToExport = wallSide
      ? result.walls.filter((w) => w.side === wallSide)
      : result.walls;

    for (const wall of wallsToExport) {
      const { vertices, faces, newOffset } = this.generateWallGeometry(
        wall,
        result.scaffoldWidthMm,
        vertexOffset,
      );
      lines.push(...vertices);
      lines.push(...faces);
      vertexOffset = newOffset;
    }

    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Generate geometry for a single wall
   */
  private generateWallGeometry(
    wall: WallCalculationResult,
    scaffoldWidthMm: number,
    vertexOffset: number,
  ): { vertices: string[]; faces: string[]; newOffset: number } {
    const vertices: string[] = [];
    const faces: string[] = [];
    let currentOffset = vertexOffset;

    const scale = 0.001; // Convert mm to meters for OBJ
    const levelHeight = 1800;
    const jackHeight = 300;

    // Calculate post positions
    const postX: number[] = [0];
    let currentX = 0;
    for (const span of wall.spans) {
      currentX += span;
      postX.push(currentX);
    }

    // Generate post vertices (simplified as boxes)
    for (const x of postX) {
      for (const z of [0, scaffoldWidthMm]) {
        const xPos = x * scale;
        const zPos = z * scale;
        const height = (wall.levelCalc.fullLevels * levelHeight + wall.levelCalc.topGuardHeightMm) * scale;
        const yBase = jackHeight * scale;
        const radius = 24.3 * scale; // φ48.6mm / 2

        // Create cylinder vertices (simplified as 8-sided polygon)
        const sides = 8;
        for (let i = 0; i < sides; i++) {
          const angle = (i / sides) * Math.PI * 2;
          const vx = xPos + Math.cos(angle) * radius;
          const vz = zPos + Math.sin(angle) * radius;
          // Bottom
          vertices.push(`v ${vx.toFixed(6)} ${yBase.toFixed(6)} ${vz.toFixed(6)}`);
          // Top
          vertices.push(`v ${vx.toFixed(6)} ${(yBase + height).toFixed(6)} ${vz.toFixed(6)}`);
        }

        // Create faces for cylinder
        for (let i = 0; i < sides; i++) {
          const next = (i + 1) % sides;
          const b1 = currentOffset + i * 2;
          const t1 = currentOffset + i * 2 + 1;
          const b2 = currentOffset + next * 2;
          const t2 = currentOffset + next * 2 + 1;
          faces.push(`f ${b1 + 1} ${b2 + 1} ${t2 + 1} ${t1 + 1}`);
        }

        currentOffset += sides * 2;
      }
    }

    return { vertices, faces, newOffset: currentOffset };
  }
}
