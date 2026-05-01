import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  STRUCTURAL_ELEMENT_TYPES,
  ELEMENT_LINE_KINDS,
  type ElementLineKind,
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
  /** Single-member length in mm when readable from the schedule. */
  pieceLengthMm?: number | null;
  phase?: string | null;
  shop?: string | null;
  /** member | bolt | connection | misc — bolts map to brace + lineKind bolt in downstream steel rollups. */
  lineKind?: ElementLineKind | null;
  /** Model self-reported 0–1 confidence for this row; drives needs_review server-side. */
  confidence?: number | null;
  notes?: string | null;
}

export interface AiElementVisionResult {
  rows: AiExtractedElement[];
  warnings: string[];
  rawText?: string;
}

const SYSTEM_PROMPT_BASE = `You are reading a Japanese structural-engineering drawing (possibly one sheet of a PDF set).
Extract EVERY steel member line you can read: columns, beams, braces, stairs, elevator shaft pieces, and bolt / 高力ボルト lines when shown in a table.
Do NOT output deck plates, floor slabs, or non-steel slab areas as rows (omit デッキ / 床スラブ quantity lines).

Element type mapping (field elementType):
- 柱 -> hashira
- 大梁 -> oobari
- 小梁 -> kobari
- 孫梁 / tertiary beams between kobari (often still labeled "b" on plans; use magobari when the schedule names 孫梁) -> magobari
- 片持ち梁 / cantilever marks CG (girder side) or CB (beam side) -> katamochibari
- 耐風梁 / wind beam -> taifubari. On many JP steel framing plans the member tag is **Hb** or **HB** plus digits (e.g. HB30); map those to taifubari. Some offices abbreviate **horizontal brace** differently — if the legend says **水平ブレース** / horizontal brace, use brace; do not guess HB alone without digits or legend context.
- ブレース / 筋交 / BR+n / V+n / TB-M*n (tube brace) / HV+n (horizontal brace) / generic T+n tie rods on plans -> brace
- 鉄骨柱・SC*/SQ* column marks -> hashira
- 基礎大梁 / nFG* foundation girder symbols -> oobari
- EV* / ELV* / EL* hoist marks (whole symbol cells) -> elevator
- 階段 -> kaidan
- エレベーター / EV / ELV -> elevator

Line kind (field lineKind, default "member"):
- Steel shapes H/□/L/CT/PL etc. -> "member"
- 高力ボルト / アンカーボルト / ボルト類 rows (not structural shapes) -> "bolt"
- 溶接 / 接合部品が部材と一体でない場合 -> "connection"
- その他副資材 -> "misc"

Floor labels normalize to 1F / 2F / ... / RF / B1 / PH.
Block (工区) is one of A/B/C/D, or null.
Quantities are integers (本数 / 個数). Sections: steel callout as written (e.g. "H-600x200x11x17") or bolt spec (e.g. "S10T HTB-20x65").
pieceLengthMm: member length in millimetres when a length column exists (設計数量 as mm or m — convert m to mm).
phase: short text if a 工程 / フェーズ column exists. shop: 製作場 / 工場タグ if present.
confidence: 0–1 per row for your own certainty (low when occluded or guessed).

OUTPUT RULES:
* Respond with a single JSON object on one line.
* Shape: {"rows":[{"level":"2F","block":"A","elementType":"oobari","lineKind":"member","label":"G1","section":"H-600x200x11x17","pieceLengthMm":6000,"qty":8,"grid":"X1-X8","phase":null,"shop":null,"confidence":0.92,"notes":null}, ...]}
* Use null where unknown. Do not invent grids or lengths.
* If you can't confidently identify any rows, return {"rows":[]}.
* Never wrap the JSON in markdown fences or commentary.`;

const KIND_HINTS: Record<DrawingKind, string> = {
  framing_plan:
    'This sheet is a framing plan (伏図). Member tags: G*=oobari; B/b/BG*=kobari; C*=hashira; CG/CB*=katamochibari; HB/Hb+digits=taifubari; RG/RB roof; nG/nB storey beams; BR/V/HV/TB-M*=brace; SC/SQ*=column; P*=purlin tier→kobari; nFG*=foundation girder→oobari; EV/ELV/EL*=elevator; T+n often brace if clearly tension rod on brace sheets.',
  column_list:
    'This sheet is a 柱リスト. Extract one row per column mark with its section + qty. Set elementType=hashira on every row.',
  beam_list:
    'This sheet is a 梁リスト. Extract one row per beam mark; map 大梁/小梁/孫梁/片持梁/耐風梁 to oobari/kobari/magobari/katamochibari/taifubari.',
  stair_detail:
    'This sheet is a stair detail / section (階段詳細, 踊り場, 蹴込, 平面/断面). Most quantity lines are elementType=kaidan (steel stair flights, landings, supports as listed).',
  elevator_shaft:
    'This sheet is an elevator / hoistway drawing (EV / ELV, シャフト, ピット, 機械室, 昇降機). Quantity lines map to elementType=elevator.',
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
      || this.configService.get<string>('ANTHROPIC_VISION_MODEL')?.trim()
      || this.configService.get<string>('ANTHROPIC_MODEL')?.trim()
      || 'claude-sonnet-4-6';

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
      max_tokens: 8192,
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
      const lkRaw = typeof r?.lineKind === 'string' ? r.lineKind.trim().toLowerCase() : '';
      const lineKind = (ELEMENT_LINE_KINDS as readonly string[]).includes(lkRaw)
        ? (lkRaw as ElementLineKind)
        : ('member' as ElementLineKind);
      let pieceLengthMm: number | null = null;
      if (r?.pieceLengthMm != null && Number.isFinite(Number(r.pieceLengthMm))) {
        const pl = Math.floor(Number(r.pieceLengthMm));
        if (pl > 0) pieceLengthMm = Math.min(120_000, pl);
      }
      let confidence: number | null = null;
      if (r?.confidence != null && Number.isFinite(Number(r.confidence))) {
        confidence = Math.min(1, Math.max(0, Number(r.confidence)));
      }
      rows.push({
        level,
        block,
        elementType: elementTypeRaw as StructuralElementType,
        label: typeof r?.label === 'string' && r.label.trim() ? r.label.trim() : null,
        section: typeof r?.section === 'string' && r.section.trim() ? r.section.trim() : null,
        qty,
        grid: typeof r?.grid === 'string' && r.grid.trim() ? r.grid.trim() : null,
        pieceLengthMm,
        phase: typeof r?.phase === 'string' && r.phase.trim() ? r.phase.trim().slice(0, 200) : null,
        shop: typeof r?.shop === 'string' && r.shop.trim() ? r.shop.trim().slice(0, 200) : null,
        lineKind,
        confidence,
        notes: typeof r?.notes === 'string' && r.notes.trim() ? r.notes.trim().slice(0, 500) : null,
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
