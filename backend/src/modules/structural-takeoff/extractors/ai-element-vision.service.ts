import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  STRUCTURAL_ELEMENT_TYPES,
  type StructuralElementType,
  type DrawingKind,
} from '../element-types';

export interface AiExtractedElement {
  level: string;
  block: string | null;
  elementType: StructuralElementType;
  label: string | null;
  section: string | null;
  qty: number;
  grid: string | null;
}

export interface AiElementVisionResult {
  rows: AiExtractedElement[];
  warnings: string[];
  rawText?: string;
}

const SYSTEM_PROMPT_BASE = `You are reading a Japanese structural-engineering drawing.
Extract the rows visible on the drawing into a strict JSON schema. Mapping:
- 柱 -> hashira
- 大梁 -> oobari
- 小梁 -> kobari
- 耐風梁 -> taifubari
- ブレース / 筋交 -> brace
- 階段 -> kaidan
- エレベーター / EV -> elevator
- デッキ / 床 -> deck

Floor labels normalize to 1F / 2F / ... / RF / B1 / PH.
Block (工区) is one of A/B/C/D, or null.
Quantities are integers. Sections include the steel section text as written
on the drawing (e.g. "H-600x200x11x17").

OUTPUT RULES:
* Respond with a single JSON object on one line.
* Shape: {"rows":[{"level":"2F","block":"A","elementType":"oobari","label":"G1","section":"H-600x200x11x17","qty":8,"grid":"X1-X8"}, ...]}
* Use null where unknown. Do not invent grids.
* If you can't confidently identify any rows, return {"rows":[]}.
* Never wrap the JSON in markdown fences or commentary.`;

const KIND_HINTS: Record<DrawingKind, string> = {
  framing_plan:
    'This sheet is a framing plan (伏図). Look for column callouts (e.g. C1) AND beam callouts (G1, b1, W1). Each row corresponds to one element type.',
  column_list:
    'This sheet is a 柱リスト. Extract one row per column mark with its section + qty. Set elementType=hashira on every row.',
  beam_list:
    'This sheet is a 梁リスト. Extract one row per beam mark; map 大梁/小梁/耐風梁 to oobari/kobari/taifubari.',
  stair_detail:
    'This sheet is a stair detail. Most rows have elementType=kaidan. Capture pre-fab unit counts.',
  elevator_shaft:
    'This sheet is an elevator (EV) shaft drawing. Most rows have elementType=elevator. Note distinct components (rails, doors, controllers) but they all map to elevator for our schema.',
  level_diagram:
    'This is the level / storey diagram (階高表). Skip — return {"rows":[]}.',
  general:
    'Generic drawing. Be conservative; if you cannot identify structural elements with high confidence, return an empty rows array.',
  unknown:
    'Drawing kind unknown. Inspect the title block for hints; otherwise return {"rows":[]}.',
};

@Injectable()
export class AiElementVisionService {
  private readonly logger = new Logger(AiElementVisionService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return !!(this.configService.get<string>('ANTHROPIC_API_KEY') || '').trim();
  }

  /**
   * Send an image (or PDF-derived image) to Claude Vision and return a
   * normalized list of structural elements suitable for upsert into the
   * extracted_elements table with source='ai'.
   */
  async extract(
    imageBuffer: Buffer,
    options: { filename: string; kind: DrawingKind | null; level: string | null; block: string | null },
  ): Promise<AiElementVisionResult> {
    const apiKey = (this.configService.get<string>('ANTHROPIC_API_KEY') || '').trim();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    const Anthropic = await import('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey });

    const base64 = imageBuffer.toString('base64');
    const mediaType = this.detectImageMediaType(imageBuffer);
    const model = this.configService.get<string>('ANTHROPIC_ELEMENT_MODEL')?.trim()
      || this.configService.get<string>('ANTHROPIC_MODEL')?.trim()
      || 'claude-3-5-sonnet-20241022';

    const kind: DrawingKind = options.kind ?? 'unknown';
    const hint = KIND_HINTS[kind] ?? KIND_HINTS.unknown;
    const userText = [
      `Drawing kind hint: ${kind} (${hint})`,
      options.level ? `Floor hint: ${options.level}` : '',
      options.block ? `Block hint: ${options.block}` : '',
      `Filename: ${options.filename}`,
      '',
      'Return the single-line JSON described in the system prompt.',
    ]
      .filter(Boolean)
      .join('\n');

    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0,
      system: SYSTEM_PROMPT_BASE,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === 'text') as { text: string } | undefined;
    const text = textBlock?.text?.trim() ?? '';
    return this.parseResponse(text, options);
  }

  private parseResponse(
    text: string,
    options: { level: string | null; block: string | null },
  ): AiElementVisionResult {
    const warnings: string[] = [];
    if (!text) return { rows: [], warnings: ['Vision returned empty response'] };
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (err) {
      this.logger.warn(`AI element vision JSON parse failed: ${(err as Error).message}`);
      return { rows: [], warnings: [`Could not parse AI response: ${(err as Error).message}`], rawText: text };
    }
    const rawRows: any[] = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const rows: AiExtractedElement[] = [];
    for (const r of rawRows) {
      const elementTypeRaw = String(r?.elementType ?? '').trim();
      if (!STRUCTURAL_ELEMENT_TYPES.includes(elementTypeRaw as StructuralElementType)) {
        warnings.push(`Skipped row with unknown elementType: ${elementTypeRaw}`);
        continue;
      }
      const qty = Number.parseInt(String(r?.qty ?? '0'), 10);
      if (!Number.isFinite(qty) || qty < 0) {
        warnings.push(`Skipped row with invalid qty: ${r?.qty}`);
        continue;
      }
      const level = this.normalizeLevel(r?.level) ?? options.level ?? '1F';
      const block = (typeof r?.block === 'string' && r.block.trim()) ? r.block.trim().toUpperCase() : options.block;
      rows.push({
        level,
        block,
        elementType: elementTypeRaw as StructuralElementType,
        label: typeof r?.label === 'string' && r.label.trim() ? r.label.trim() : null,
        section: typeof r?.section === 'string' && r.section.trim() ? r.section.trim() : null,
        qty,
        grid: typeof r?.grid === 'string' && r.grid.trim() ? r.grid.trim() : null,
      });
    }
    return { rows, warnings, rawText: text };
  }

  private normalizeLevel(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    if (!t) return null;
    const m = t.match(/^(B?\d+|R|PH)\s*(?:F|階)?$/i);
    if (m) {
      const head = m[1].toUpperCase();
      if (head === 'R') return 'R';
      if (head === 'PH') return 'PH';
      if (head.startsWith('B')) return head;
      return `${head}F`;
    }
    if (/^\d+$/.test(t)) return `${t}F`;
    return t.slice(0, 6);
  }

  private detectImageMediaType(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57) return 'image/webp';
    return 'image/png';
  }
}
