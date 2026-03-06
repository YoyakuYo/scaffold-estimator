import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Structured footprint output from vision (2D polygon + height). */
export interface VisionFootprintResult {
  /** Polygon vertices: in mm (x, z) or 0-1 fraction. Prefer mm for scaling. */
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  /** Building height in mm */
  buildingHeightMm: number;
  /** Ground line detected (optional) */
  groundLineY?: number;
  /** Eaves line / top (optional) */
  eavesLineY?: number;
  /** Confidence 0-1 */
  confidence?: number;
}

const VISION_SYSTEM_PROMPT = `You are a construction drawing analyst. Analyze the image (photo or blueprint) and extract building footprint and height for scaffold estimation.

Output a JSON object with:
- vertices: array of polygon vertices for the building footprint (closed polygon). Each vertex: { x, y } in millimeters, or { xFrac, yFrac } if using 0-1 normalized coordinates. Use consistent units. For blueprints, infer scale from dimensions or typical floor heights.
- buildingHeightMm: total building height in millimeters (from ground to eaves/top).
- groundLineY: optional, Y coordinate of ground line if visible.
- eavesLineY: optional, Y of eaves/top if visible.
- confidence: optional number 0-1.

Rules:
- Footprint must be a closed polygon (at least 3 vertices). Rectangle = 4 vertices.
- All dimensions in millimeters (mm).
- If scale is unknown, use typical single-story height ~3000mm and estimate footprint from proportions.`;

@Injectable()
export class VisionBimService {
  private readonly logger = new Logger(VisionBimService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Process an image buffer (photo or blueprint) with Claude 3.5 Sonnet Vision.
   * Returns structured footprint JSON for the BuildingGraph / scaffold estimator.
   */
  async processImage(buffer: Buffer): Promise<VisionFootprintResult> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set; returning fallback footprint');
      return this.getFallbackFootprint();
    }

    try {
      const Anthropic = await import('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey });

      const base64 = buffer.toString('base64');
      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
      const mediaType = isJpeg ? 'image/jpeg' : 'image/png';

      const message = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: VISION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: 'text',
                text: 'Extract the building footprint polygon (vertices in mm or xFrac/yFrac) and building height in mm. Reply with only the JSON object, no markdown.',
              },
            ],
          },
        ],
      });

      const textBlock = message.content.find((b: any) => b.type === 'text');
      const text = textBlock && typeof (textBlock as any).text === 'string' ? (textBlock as any).text : '';
      const jsonStr = text.replace(/```json?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(jsonStr) as VisionFootprintResult;

      if (!parsed.vertices || !Array.isArray(parsed.vertices) || parsed.vertices.length < 3) {
        this.logger.warn('Vision returned invalid vertices; using fallback');
        return this.getFallbackFootprint();
      }
      if (!parsed.buildingHeightMm || parsed.buildingHeightMm < 1000) {
        parsed.buildingHeightMm = 3000;
      }
      return parsed;
    } catch (err) {
      this.logger.error('Vision BIM processing failed', (err as Error)?.message);
      return this.getFallbackFootprint();
    }
  }

  private getFallbackFootprint(): VisionFootprintResult {
    return {
      vertices: [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
        { x: 10000, y: 8000 },
        { x: 0, y: 8000 },
      ],
      buildingHeightMm: 3000,
      confidence: 0,
    };
  }
}
