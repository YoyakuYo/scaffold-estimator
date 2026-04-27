import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DRAWING_KINDS,
  type DrawingKind,
} from '../element-types';

export interface TitleBlockClassification {
  kind: DrawingKind | null;
  level: string | null;
  block: string | null;
  confidence: number;
  /** Anthropic's raw JSON for diagnostic logging (small subset). */
  rawText?: string;
}

const SYSTEM_PROMPT = `You are an expert reader of Japanese structural construction drawings.
Look at the title block (タイトルブロック / 題名欄) — usually the rectangular
block in the bottom-right or right edge of the sheet — and determine:

1. The drawing kind (one of: framing_plan / column_list / beam_list /
   stair_detail / elevator_shaft / level_diagram / general / unknown).
   Map common Japanese names: 伏図 → framing_plan; 柱リスト → column_list;
   大梁リスト or 小梁リスト or 梁リスト → beam_list; 階段詳細 → stair_detail;
   EVシャフト → elevator_shaft; 階高表 → level_diagram.
2. The floor it represents, normalized to one of: 1F, 2F, ..., RF, B1, B2, PH.
   Recognize 1階, 2階, 屋階, 地下1階, 塔屋, etc.
3. The construction block / 工区, if shown (A, B, C, D), else null.
4. Your overall confidence (0.0 to 1.0).

Respond ONLY with a single JSON object on one line:
{"kind":"framing_plan","level":"2F","block":"A","confidence":0.9}

Never wrap the JSON in code fences. If you cannot determine a field, use null.`;

@Injectable()
export class TitleBlockVisionService {
  private readonly logger = new Logger(TitleBlockVisionService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return !!(this.configService.get<string>('ANTHROPIC_API_KEY') || '').trim();
  }

  /**
   * Send the cropped/full title-block image to Claude Vision and return a
   * parsed classification. PDF callers should rasterize page 1 with Sharp
   * (200 DPI, max 2048 px) before calling this so the buffer is always an
   * image ready for the Messages API.
   */
  async classifyImage(imageBuffer: Buffer, filename: string): Promise<TitleBlockClassification> {
    const apiKey = (this.configService.get<string>('ANTHROPIC_API_KEY') || '').trim();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    const Anthropic = await import('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey });

    const base64 = imageBuffer.toString('base64');
    const mediaType = this.detectImageMediaType(imageBuffer);
    const model = this.configService.get<string>('ANTHROPIC_TITLE_BLOCK_MODEL')?.trim()
      || this.configService.get<string>('ANTHROPIC_MODEL')?.trim()
      || 'claude-3-5-haiku-20241022';

    const message = await client.messages.create({
      model,
      max_tokens: 256,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `Drawing filename hint: ${filename}\n\nRespond with the single-line JSON.`,
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === 'text') as { text: string } | undefined;
    const text = textBlock?.text?.trim() ?? '';
    return this.parseClassificationResponse(text);
  }

  private parseClassificationResponse(text: string): TitleBlockClassification {
    if (!text) {
      return { kind: null, level: null, block: null, confidence: 0 };
    }
    // Pull the first { ... } block, defensive against accidental commentary.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : text;
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      this.logger.warn(`Could not parse title-block JSON: ${(err as Error).message}`);
      return { kind: null, level: null, block: null, confidence: 0, rawText: text };
    }

    const rawKind = typeof parsed.kind === 'string' ? parsed.kind.toLowerCase() : null;
    const kind = rawKind && (DRAWING_KINDS as readonly string[]).includes(rawKind) ? (rawKind as DrawingKind) : null;
    const level = typeof parsed.level === 'string' ? this.normalizeLevel(parsed.level) : null;
    const block = typeof parsed.block === 'string' ? parsed.block.trim().toUpperCase().slice(0, 4) || null : null;
    const conf = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.6;
    return { kind, level, block, confidence: conf, rawText: text };
  }

  private normalizeLevel(raw: string): string | null {
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
    // Default; Anthropic accepts png/jpeg/webp/gif. Best fallback for unknown.
    return 'image/png';
  }
}
