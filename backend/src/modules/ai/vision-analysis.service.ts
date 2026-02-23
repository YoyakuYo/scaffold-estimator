import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Structured result from AI vision analysis of a construction drawing.
 */
export interface VisionAnalysisResult {
  /** Whether AI analysis succeeded */
  success: boolean;
  /** Detected building shape: 'rectangular', 'L-shaped', 'U-shaped', 'complex', etc. */
  buildingShape: string;
  /** Building height in mm */
  buildingHeightMm: number | null;
  /** Number of floors detected */
  floorCount: number | null;
  /** Structure type detected */
  structureType: '改修工事' | 'S造' | 'RC造' | null;
  /** Wall dimensions detected */
  walls: Array<{
    side: string;
    lengthMm: number | null;
    heightMm: number | null;
  }>;
  /** Drawing type detected */
  drawingType: 'plan' | 'elevation' | 'section' | 'perspective' | 'unknown';
  /** Scale detected (e.g., "1:100") */
  scale: string | null;
  /** Confidence score 0-1 */
  confidence: number;
  /** Additional notes from AI */
  notes: string;
  /** Raw AI response for debugging */
  rawResponse: string;
  /** Error message if failed */
  error: string | null;
}

@Injectable()
export class VisionAnalysisService {
  private readonly logger = new Logger(VisionAnalysisService.name);

  constructor(private aiService: AiService) {}

  private edgeLetter(index: number): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (index < alphabet.length) return alphabet[index];
    const cycle = Math.floor(index / alphabet.length);
    const pos = index % alphabet.length;
    return `${alphabet[pos]}${cycle}`;
  }

  private makeEdgeLabel(index: number, total: number): string {
    const current = this.edgeLetter(index);
    const next = this.edgeLetter((index + 1) % Math.max(total, 1));
    return `${current}${next}`;
  }

  private postProcessResult(parsed: any, rawResponse: string): VisionAnalysisResult {
    type VisionWall = VisionAnalysisResult['walls'][number];
    const structureType = parsed?.structureType || null;
    let floorCount =
      typeof parsed?.floorCount === 'number' && Number.isFinite(parsed.floorCount)
        ? parsed.floorCount
        : null;

    // Preserve explicit value when present; otherwise estimate from floor count when possible.
    let buildingHeightMm =
      typeof parsed?.buildingHeightMm === 'number' && Number.isFinite(parsed.buildingHeightMm)
        ? parsed.buildingHeightMm
        : null;
    if (buildingHeightMm == null && floorCount && floorCount > 0) {
      const typicalFloorHeight = structureType === 'S造' ? 3500 : 3000;
      buildingHeightMm = floorCount * typicalFloorHeight;
    }
    // Last-resort estimation for plan drawings with no explicit height data.
    if (buildingHeightMm == null) {
      const assumedFloors = floorCount && floorCount > 0 ? floorCount : 2;
      floorCount = assumedFloors;
      const typicalFloorHeight = structureType === 'S造' ? 3500 : 3000;
      buildingHeightMm = assumedFloors * typicalFloorHeight;
    }

    let walls: VisionWall[] = Array.isArray(parsed?.walls)
      ? parsed.walls.map((wall: any) => ({
          side: typeof wall?.side === 'string' ? wall.side : 'edge_1',
          lengthMm:
            typeof wall?.lengthMm === 'number' && Number.isFinite(wall.lengthMm)
              ? wall.lengthMm
              : null,
          // If explicit wall height is missing but building height is known/estimated, use it.
          heightMm:
            typeof wall?.heightMm === 'number' && Number.isFinite(wall.heightMm)
              ? wall.heightMm
              : buildingHeightMm,
        }))
      : [];

    const isCardinal = (side: string) =>
      ['north', 'south', 'east', 'west'].includes((side || '').toLowerCase());
    const shouldUseEdgeLabels =
      walls.length > 0 &&
      (walls.length > 4 ||
        ['L-shaped', 'U-shaped', 'complex'].includes(parsed?.buildingShape) ||
        walls.some((w: VisionWall) => !isCardinal(w.side) || /^edge[_-]?\d+/i.test(w.side)));

    if (shouldUseEdgeLabels) {
      walls = walls.map((wall: VisionWall, i: number) => ({
        ...wall,
        side: this.makeEdgeLabel(i, walls.length),
      }));
    }

    return {
      success: true,
      buildingShape: parsed?.buildingShape || 'unknown',
      buildingHeightMm,
      floorCount,
      structureType,
      walls,
      drawingType: parsed?.drawingType || 'unknown',
      scale: parsed?.scale || null,
      confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : 0.5,
      notes: parsed?.notes || '',
      rawResponse,
      error: null,
    };
  }

  /**
   * Analyze a construction drawing image using OpenAI Vision.
   * Extracts building dimensions, wall lengths, heights, structure type, etc.
   */
  async analyzeDrawing(filePath: string): Promise<VisionAnalysisResult> {
    if (!this.aiService.isAvailable()) {
      this.logger.error('OpenAI API key not configured. Set OPENAI_API_KEY in .env file in backend directory');
      return {
        success: false,
        buildingShape: 'unknown',
        buildingHeightMm: null,
        floorCount: null,
        structureType: null,
        walls: [],
        drawingType: 'unknown',
        scale: null,
        confidence: 0,
        notes: '',
        rawResponse: '',
        error: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env file in backend directory',
      };
    }

    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new BadRequestException(`File not found: ${absolutePath}`);
    }

    try {
      // Read image and convert to base64
      const imageBuffer = fs.readFileSync(absolutePath);
      const base64Image = imageBuffer.toString('base64');
      const ext = path.extname(absolutePath).toLowerCase().replace('.', '');
      const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      this.logger.log(`Sending drawing to OpenAI Vision for analysis (${(imageBuffer.length / 1024).toFixed(0)} KB)`);

      const response = await this.aiService.client.chat.completions.create({
        model: this.aiService.getModel(),
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are an expert Japanese construction drawing analyzer specializing in scaffold estimation.
Analyze the uploaded architectural drawing and extract structured dimensional data.

IMPORTANT RULES:
- All dimensions must be in millimeters (mm).
- If dimensions are in meters, convert to mm (multiply by 1000).
- If a scale is shown (e.g., 1:100), apply it to convert drawn dimensions to real dimensions.
- Wall sides should be labeled as: north, south, east, west (or edge_1, edge_2, etc. for complex shapes).
- For L-shaped/U-shaped/complex footprints, DO NOT simplify to a bounding rectangle.
- Return one wall entry per outer boundary edge in clockwise order.
- If there are more than 4 outer edges, use edge_1, edge_2, ... edge_n.
- For building height: look for floor-to-floor heights, total height annotations, or count floors × typical height (3000mm/floor for RC, 3500mm/floor for S造).
- If exact height is not visible, estimate floorCount and height from drawing context (typical: 2 floors for detached house plans).
- Structure type: RC造 (reinforced concrete), S造 (steel frame), 改修工事 (renovation).
- Confidence should reflect how clearly the dimensions are readable.

Return ONLY valid JSON matching this schema:
{
  "buildingShape": "rectangular" | "L-shaped" | "U-shaped" | "complex",
  "buildingHeightMm": number | null,
  "floorCount": number | null,
  "structureType": "改修工事" | "S造" | "RC造" | null,
  "walls": [
    { "side": "north|south|east|west|AB|BC|CD...", "lengthMm": number | null, "heightMm": number | null },
    ...
  ],
  "drawingType": "plan" | "elevation" | "section" | "perspective" | "unknown",
  "scale": "1:100" | null,
  "confidence": 0.0-1.0,
  "notes": "string with any important observations"
}`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this construction drawing and extract all dimensional data for scaffold estimation. Return structured JSON only.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
      });

      const rawText = response.choices[0]?.message?.content || '';
      this.logger.log(`OpenAI Vision response received (${rawText.length} chars)`);

      // Parse JSON from response (handle markdown code blocks)
      let jsonStr = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      return this.postProcessResult(parsed, rawText);
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      const errorCode = error?.status || error?.code || 'UNKNOWN';
      this.logger.error(`Vision analysis failed: ${errorMessage} (code: ${errorCode})`);
      if (error?.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
      
      // Check for specific OpenAI API errors
      if (error?.status === 401) {
        return {
          success: false,
          buildingShape: 'unknown',
          buildingHeightMm: null,
          floorCount: null,
          structureType: null,
          walls: [],
          drawingType: 'unknown',
          scale: null,
          confidence: 0,
          notes: '',
          rawResponse: '',
          error: 'Invalid OpenAI API key. Please check OPENAI_API_KEY in .env file.',
        };
      }
      if (error?.status === 429) {
        return {
          success: false,
          buildingShape: 'unknown',
          buildingHeightMm: null,
          floorCount: null,
          structureType: null,
          walls: [],
          drawingType: 'unknown',
          scale: null,
          confidence: 0,
          notes: '',
          rawResponse: '',
          error: 'OpenAI API rate limit exceeded. Please try again later.',
        };
      }
      if (error?.status === 400 && errorMessage.includes('model')) {
        return {
          success: false,
          buildingShape: 'unknown',
          buildingHeightMm: null,
          floorCount: null,
          structureType: null,
          walls: [],
          drawingType: 'unknown',
          scale: null,
          confidence: 0,
          notes: '',
          rawResponse: '',
          error: `Invalid model name. Please check OPENAI_MODEL in .env. Error: ${errorMessage}`,
        };
      }
      
      return {
        success: false,
        buildingShape: 'unknown',
        buildingHeightMm: null,
        floorCount: null,
        structureType: null,
        walls: [],
        drawingType: 'unknown',
        scale: null,
        confidence: 0,
        notes: '',
        rawResponse: '',
        error: `AI analysis failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Analyze a drawing from a base64-encoded image string (for frontend uploads).
   */
  async analyzeDrawingBase64(base64Data: string, mimeType: string = 'image/jpeg'): Promise<VisionAnalysisResult> {
    if (!this.aiService.isAvailable()) {
      return {
        success: false,
        buildingShape: 'unknown',
        buildingHeightMm: null,
        floorCount: null,
        structureType: null,
        walls: [],
        drawingType: 'unknown',
        scale: null,
        confidence: 0,
        notes: '',
        rawResponse: '',
        error: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env',
      };
    }

    try {
      // Strip data URL prefix if present
      const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

      this.logger.log(`Sending base64 drawing to OpenAI Vision for analysis`);

      const response = await this.aiService.client.chat.completions.create({
        model: this.aiService.getModel(),
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are an expert Japanese construction drawing analyzer specializing in scaffold estimation.
Analyze the uploaded architectural drawing and extract structured dimensional data.

IMPORTANT RULES:
- All dimensions must be in millimeters (mm).
- If dimensions are in meters, convert to mm (multiply by 1000).
- If a scale is shown (e.g., 1:100), apply it to convert drawn dimensions to real dimensions.
- Wall sides should be labeled as: north, south, east, west (or edge_1, edge_2, etc. for complex shapes).
- For L-shaped/U-shaped/complex footprints, DO NOT simplify to a bounding rectangle.
- Return one wall entry per outer boundary edge in clockwise order.
- If there are more than 4 outer edges, use edge_1, edge_2, ... edge_n.
- For building height: look for floor-to-floor heights, total height annotations, or count floors × typical height (3000mm/floor for RC, 3500mm/floor for S造).
- If exact height is not visible, estimate floorCount and height from drawing context (typical: 2 floors for detached house plans).
- Structure type: RC造 (reinforced concrete), S造 (steel frame), 改修工事 (renovation).
- Confidence should reflect how clearly the dimensions are readable.

Return ONLY valid JSON matching this schema:
{
  "buildingShape": "rectangular" | "L-shaped" | "U-shaped" | "complex",
  "buildingHeightMm": number | null,
  "floorCount": number | null,
  "structureType": "改修工事" | "S造" | "RC造" | null,
  "walls": [
    { "side": "north|south|east|west|AB|BC|CD...", "lengthMm": number | null, "heightMm": number | null },
    ...
  ],
  "drawingType": "plan" | "elevation" | "section" | "perspective" | "unknown",
  "scale": "1:100" | null,
  "confidence": 0.0-1.0,
  "notes": "string with any important observations"
}`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this construction drawing and extract all dimensional data for scaffold estimation. Return structured JSON only.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${cleanBase64}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
      });

      const rawText = response.choices[0]?.message?.content || '';

      let jsonStr = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      return this.postProcessResult(parsed, rawText);
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      const errorCode = error?.status || error?.code || 'UNKNOWN';
      this.logger.error(`Vision analysis (base64) failed: ${errorMessage} (code: ${errorCode})`);
      if (error?.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
      
      // Check for specific OpenAI API errors
      if (error?.status === 401) {
        return {
          success: false,
          buildingShape: 'unknown',
          buildingHeightMm: null,
          floorCount: null,
          structureType: null,
          walls: [],
          drawingType: 'unknown',
          scale: null,
          confidence: 0,
          notes: '',
          rawResponse: '',
          error: 'Invalid OpenAI API key. Please check OPENAI_API_KEY in .env file.',
        };
      }
      if (error?.status === 429) {
        return {
          success: false,
          buildingShape: 'unknown',
          buildingHeightMm: null,
          floorCount: null,
          structureType: null,
          walls: [],
          drawingType: 'unknown',
          scale: null,
          confidence: 0,
          notes: '',
          rawResponse: '',
          error: 'OpenAI API rate limit exceeded. Please try again later.',
        };
      }
      if (error?.status === 400 && errorMessage.includes('model')) {
        return {
          success: false,
          buildingShape: 'unknown',
          buildingHeightMm: null,
          floorCount: null,
          structureType: null,
          walls: [],
          drawingType: 'unknown',
          scale: null,
          confidence: 0,
          notes: '',
          rawResponse: '',
          error: `Invalid model name. Please check OPENAI_MODEL in .env. Error: ${errorMessage}`,
        };
      }
      
      return {
        success: false,
        buildingShape: 'unknown',
        buildingHeightMm: null,
        floorCount: null,
        structureType: null,
        walls: [],
        drawingType: 'unknown',
        scale: null,
        confidence: 0,
        notes: '',
        rawResponse: '',
        error: `AI analysis failed: ${errorMessage}`,
      };
    }
  }
}
