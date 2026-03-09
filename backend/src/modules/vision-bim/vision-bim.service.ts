import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DxfParser = require('dxf-parser');

/** Structured footprint output from vision or CAD (2D polygon + height). */
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
  /** Scale denominator from drawing (e.g. 100 for S=1/100). */
  scaleDenominator?: number;
  /** Per-edge lengths in mm, one per polygon edge (same order as vertices). Use dimension text from plan. */
  wallLengthsMm?: number[];
  /** Inferred scaffold type from plan: 枠組足場 (1829/914 etc.) vs くさび式 (600/900 etc.). */
  scaffoldTypeHint?: 'kusabi' | 'wakugumi';
  /** Span size in mm if visible (e.g. 1829 for wakugumi, 900 for kusabi). */
  spanSizeMm?: number;
  /** Frame size in mm for 枠組足場: 1700, 1800, or 1900. */
  frameSizeMm?: number;
  /** True when wallLengthsMm was read from plan dimension text (not estimated). */
  wallLengthsFromDimText?: boolean;
}

/** Supported CAD/plan extensions (lowercase). */
const CAD_EXTENSIONS = ['.dxf', '.dwg', '.jww'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const PDF_EXTENSIONS = ['.pdf'];

const VISION_SYSTEM_PROMPT = `You are a construction drawing analyst for Japanese scaffold estimation. Analyze the image (blueprint, plan, or photo) and extract the building exterior footprint, dimensions, and scaffold hints.

OUTPUT FORMAT: Output ONLY a raw JSON object. No markdown, no code fences, no prose before or after.

Required fields:
- vertices: array of polygon vertices tracing the EXTERIOR building outline in perimeter order (clockwise or counter-clockwise). Each vertex: { x, y } in millimeters, or { xFrac, yFrac } for 0-1 normalized. Prefer mm when you can read scale/dimensions.
- buildingHeightMm: total building height in mm (ground to eaves/top). If not shown, use typical 3000mm per story.

Optional fields (read from dimension lines and annotations):
- scaleDenominator: scale from drawing (e.g. 100 for S=1/100, 200 for S=1/200).
- wallLengthsMm: array of lengths in mm, one per edge, same count as vertices.
  Edge i = vertex[i] → vertex[i+1]; last edge = last vertex → first vertex (closes polygon).
  Read dimension annotations: "2945", "10@1829=18290" means 18290mm.
  IMPORTANT: Always output in mm. If plan shows metres (e.g. "7.200 m") multiply by 1000. If centimetres (e.g. "720 cm") multiply by 10.
  Only omit if no dimension annotations are visible at all.
- wallLengthsFromDimText: true if wallLengthsMm was read from explicit dimension lines; false/omit if only estimated from proportions.
- scaffoldTypeHint: "wakugumi" for 枠組足場 or imperial spans (1829/914/1219/1524); "kusabi" for くさび式 or metric spans (600/900/1200/1500/1800). Omit if unclear.
- spanSizeMm: main span in mm if visible (1829, 914, 900, 1200, etc.).
- frameSizeMm: for 枠組足場 only — 1700, 1800, or 1900 if shown.
- groundLineY, eavesLineY: optional y coordinates if visible.
- confidence: 0-1.

Polygon rules — follow these exactly:
1. CLOSED polygon: the last edge must connect back to vertex[0]. Do NOT add a duplicate of vertex[0] at the end.
2. EXTERIOR outline only: trace the outer building boundary. Ignore internal room lines, stairs, columns, grids, hatching, and scaffold layout lines.
3. Multiple outlines: use the main building outline that corresponds to the dimension strings.
4. Angled corners and cut corners must each be a separate vertex (do not simplify to a rectangle if the plan shows a notch or diagonal).
5. Vertex order: clockwise or counter-clockwise — be consistent around the whole perimeter.
6. wallLengthsMm count must equal vertices count exactly (one length per edge).

Self-check before outputting (fix issues silently — never output the check itself):
- edges count == vertices count (not vertices count + 1)
- no duplicate consecutive vertices
- no self-intersecting edges
- if wallLengthsMm provided: sum of lengths is a plausible building perimeter (>4 m, <2000 m)
- total of wallLengthsMm matches the plan's dimension string sums as closely as possible

If the drawing has a scale (S=1/100, S=1/200), set scaleDenominator and output vertices in real mm.
If scale is unknown, use xFrac/yFrac for shape.`;

@Injectable()
export class VisionBimService {
  private readonly logger = new Logger(VisionBimService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Process uploaded file: image → Claude Vision; DXF/CAD → parse outline; PDF → fallback or future PDF-to-image.
   * Filename is used for type detection when magic bytes are ambiguous.
   */
  async processFile(buffer: Buffer, filename?: string): Promise<VisionFootprintResult> {
    const ext = filename ? (filename.includes('.') ? '.' + filename.split('.').pop()!.toLowerCase() : '') : '';
    const isDxfBuffer = this.looksLikeDxf(buffer);
    const isDxf = CAD_EXTENSIONS.includes(ext) || isDxfBuffer;
    const isPdf = PDF_EXTENSIONS.includes(ext) || (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44);
    const isImage = IMAGE_EXTENSIONS.includes(ext) || this.looksLikeImage(buffer);

    if (ext === '.dwg' || ext === '.jww') {
      if (!isDxfBuffer) {
        throw new Error(
          'DWG/JWW はサーバーで直接解析できません。CADで DXF 形式にエクスポートしてからアップロードしてください。 / ' +
          'Please export the file as DXF from your CAD software and upload the DXF file.',
        );
      }
    }
    if (isDxf) {
      return this.processDxf(buffer);
    }
    if (isPdf) {
      this.logger.log('PDF upload: export as PNG/JPEG for vision analysis, or upload DXF for CAD plans');
      return this.getFallbackFootprint();
    }
    if (isImage) {
      return this.processImage(buffer);
    }
    this.logger.warn('Unknown file type; trying as image');
    return this.processImage(buffer);
  }

  private looksLikeDxf(buffer: Buffer): boolean {
    if (buffer.length < 20) return false;
    const head = buffer.slice(0, 200).toString('utf8');
    return head.includes('ENTITIES') || /^\s*0\s*\n/.test(head) || head.includes('  0\n');
  }

  private looksLikeImage(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e) return true;
    return false;
  }

  /**
   * Parse DXF buffer and extract building footprint (closed polyline or bounding outline) and height.
   */
  async processDxf(buffer: Buffer): Promise<VisionFootprintResult> {
    try {
      const text = buffer.toString('utf-8');
      const parser = new DxfParser();
      const dxf = parser.parse(text);
      if (!dxf || !dxf.entities) {
        this.logger.warn('DXF parse returned no entities');
        return this.getFallbackFootprint();
      }
      const unit = this.detectDxfUnit(dxf);
      const scaleToMm = unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1;
      let bestVertices: Array<{ x: number; y: number }> = [];
      let bestArea = 0;
      let buildingHeightMm = 3000;
      const dimensions: Array<{ value: number; vertical: boolean }> = [];

      for (const entity of dxf.entities) {
        if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
          const pts = (entity.vertices || entity.points || []).map((v: any) => ({
            x: (v.x ?? v[0] ?? 0) * scaleToMm,
            y: (v.y ?? v[1] ?? 0) * scaleToMm,
          }));
          const closed = entity.shape === true || (entity as any).closed === true || (entity as any).closed === 1;
          if (pts.length >= 3 && closed) {
            const area = Math.abs(this.polygonArea(pts));
            if (area > bestArea) {
              bestArea = area;
              bestVertices = pts;
            }
          }
        }
        if (entity.type === 'DIMENSION' && (entity as any).measurement != null) {
          const dim = entity as any;
          const vertical = Math.abs((dim.end?.y ?? 0) - (dim.start?.y ?? 0)) > Math.abs((dim.end?.x ?? 0) - (dim.start?.x ?? 0));
          dimensions.push({ value: dim.measurement * scaleToMm, vertical });
        }
      }
      const maxVerticalDim = dimensions.filter((d) => d.vertical).map((d) => d.value).reduce((a, b) => Math.max(a, b), 0);
      if (maxVerticalDim > 500) buildingHeightMm = Math.round(maxVerticalDim);

      let vertices = bestVertices;
      if (vertices.length < 3) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const e of dxf.entities) {
          if (e.type === 'LINE' && e.start && e.end) {
            const s = e.start as { x: number; y: number };
            const en = e.end as { x: number; y: number };
            minX = Math.min(minX, s.x, en.x); maxX = Math.max(maxX, s.x, en.x);
            minY = Math.min(minY, s.y, en.y); maxY = Math.max(maxY, s.y, en.y);
          }
        }
        if (minX !== Infinity && maxX - minX > 100 && maxY - minY > 100) {
          vertices = [
            { x: minX * scaleToMm, y: minY * scaleToMm },
            { x: maxX * scaleToMm, y: minY * scaleToMm },
            { x: maxX * scaleToMm, y: maxY * scaleToMm },
            { x: minX * scaleToMm, y: maxY * scaleToMm },
          ];
        }
      }
      if (vertices.length < 3) return this.getFallbackFootprint();
      return { vertices, buildingHeightMm, confidence: 0.8 };
    } catch (err) {
      this.logger.error('DXF processing failed', (err as Error)?.message);
      return this.getFallbackFootprint();
    }
  }

  private polygonArea(pts: Array<{ x: number; y: number }>): number {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return area / 2;
  }

  private detectDxfUnit(dxf: any): 'mm' | 'cm' | 'm' {
    const insunits = dxf?.header?.$INSUNITS ?? dxf?.header?.headerVars?.$INSUNITS;
    if (insunits === 4) return 'mm';
    if (insunits === 5) return 'cm';
    if (insunits === 6) return 'm';
    const measurement = dxf?.header?.$MEASUREMENT ?? dxf?.header?.headerVars?.$MEASUREMENT;
    return measurement === 0 ? 'mm' : 'cm';
  }

  /**
   * Process an image buffer (photo or blueprint) with Claude 3.5 Sonnet Vision.
   * Returns structured footprint JSON for the BuildingGraph / scaffold estimator.
   */
  async processImage(buffer: Buffer): Promise<VisionFootprintResult> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set (AI BIM vision analysis is unavailable)');
    }

    try {
      const Anthropic = await import('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey });

      const base64 = buffer.toString('base64');
      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
      const mediaType = isJpeg ? 'image/jpeg' : 'image/png';

      // Use env override or a current vision-capable model (claude-3-5-sonnet-20241022 was retired)
      const model =
        this.config.get<string>('ANTHROPIC_VISION_MODEL') ||
        'claude-sonnet-4-6';
      const message = await client.messages.create({
        model,
        max_tokens: 2048,
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
                text: 'Extract the exterior building footprint as a CLOSED polygon (last edge returns to vertex[0], no duplicate closing vertex). Trace only the outer boundary — ignore internal lines. Return raw JSON only (no markdown). Include: vertices, buildingHeightMm, and if visible: scaleDenominator, wallLengthsMm (one mm value per edge, same count as vertices), wallLengthsFromDimText, scaffoldTypeHint, spanSizeMm, frameSizeMm.',
              },
            ],
          },
        ],
      });

      const textBlock = message.content.find((b: any) => b.type === 'text');
      const text =
        textBlock && typeof (textBlock as any).text === 'string'
          ? (textBlock as any).text
          : '';

      // Robust JSON extraction: models sometimes wrap in prose or code fences.
      const cleaned = text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start < 0 || end < 0 || end <= start) {
        throw new Error('Vision model did not return JSON');
      }
      const jsonStr = cleaned.slice(start, end + 1);
      const parsed = JSON.parse(jsonStr) as VisionFootprintResult;

      if (!parsed.vertices || !Array.isArray(parsed.vertices) || parsed.vertices.length < 3) {
        throw new Error('Vision returned invalid footprint vertices');
      }
      if (!parsed.buildingHeightMm || parsed.buildingHeightMm < 1000) {
        parsed.buildingHeightMm = 3000;
      }
      const n = parsed.vertices.length;
      let wallLengths = Array.isArray(parsed.wallLengthsMm) && parsed.wallLengthsMm.length === n
        ? parsed.wallLengthsMm as number[]
        : undefined;

      if (wallLengths) {
        const maxVal = Math.max(...wallLengths);
        // If all values look like metres (max < 100), auto-convert to mm
        if (maxVal < 100 && wallLengths.every((l) => typeof l === 'number' && l > 0)) {
          wallLengths = wallLengths.map((l) => Math.round(l * 1000));
          this.logger.warn(`wallLengthsMm auto-converted from m→mm (max was ${maxVal})`);
        }
        // Discard if any value is still below minimum scaffold wall (600mm)
        if (!wallLengths.every((l) => typeof l === 'number' && l >= 600)) {
          wallLengths = undefined;
        }
      }
      parsed.wallLengthsMm = wallLengths;
      parsed.wallLengthsFromDimText = wallLengths != null
        ? (parsed.wallLengthsFromDimText === true)
        : undefined;
      if (parsed.scaffoldTypeHint !== 'kusabi' && parsed.scaffoldTypeHint !== 'wakugumi') {
        parsed.scaffoldTypeHint = undefined;
      }
      if (typeof parsed.frameSizeMm !== 'number' || ![1700, 1800, 1900].includes(parsed.frameSizeMm)) {
        parsed.frameSizeMm = undefined;
      }
      return parsed as VisionFootprintResult;
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.logger.error('Vision BIM processing failed', msg);
      throw new Error(`Vision BIM processing failed: ${msg}`);
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
