import { Injectable, Logger } from '@nestjs/common';
import type { StructuralElementType } from '../element-types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DxfParser = require('dxf-parser');

export interface DxfElementProposal {
  level: string;
  block: string | null;
  elementType: StructuralElementType;
  qty: number;
  /** Diagnostic: which DXF layer the count came from. */
  layer: string;
}

export interface DxfLayerExtractionResult {
  proposals: DxfElementProposal[];
  warnings: string[];
  /** All distinct layer names actually present in the DXF (diagnostic). */
  layers: string[];
}

/**
 * Phase 3 — Mode 3: deterministic DXF layer-based element extraction.
 *
 * Japanese steel-frame DXF drawings follow predictable layer naming
 * conventions, e.g. `S-柱`, `S-大梁`, `S-小梁`, `S-耐風梁`, `S-ブレース`.
 * This service groups entities by layer and proposes element rows for any
 * layer that maps to a known structural element category.
 *
 * Counts are heuristic per-layer entity counts. Users review and correct on
 * the front-end before saving, so over-extraction is acceptable.
 */
@Injectable()
export class DxfLayerExtractorService {
  private readonly logger = new Logger(DxfLayerExtractorService.name);

  /**
   * Layer-name pattern → element type. First match wins. Patterns are
   * case-insensitive substrings; engineers use both Japanese and English
   * naming, sometimes mixed.
   */
  private readonly LAYER_PATTERNS: Array<[RegExp, StructuralElementType]> = [
    [/(柱|hashira|column)/i, 'hashira'],
    [/(大梁|main\s*beam|girder|oobari)/i, 'oobari'],
    [/(小梁|small\s*beam|kobari)/i, 'kobari'],
    [/(耐風梁|wind\s*beam|taifubari)/i, 'taifubari'],
    [/(ブレース|brace|筋交)/i, 'brace'],
    [/(階段|ステア|stair|踊(り)?場|蹴込)/i, 'kaidan'],
    [
      /(エレベータ|エレベーター|elevator|昇降機|機械室|シャフト|^ev$|^elv$|elv\b|ev[\s_-]?shaft)/i,
      'elevator',
    ],
  ];

  /** Floor regex for inferring level from a layer name when present. */
  private readonly LEVEL_RE = /(?:^|[^A-Z0-9])(B?\d+\s*F|R\s*F|RF|PH)\b/i;

  extractFromBuffer(buffer: Buffer, fallbackLevel: string): DxfLayerExtractionResult {
    const text = buffer.toString('utf-8');
    return this.extractFromText(text, fallbackLevel);
  }

  extractFromText(text: string, fallbackLevel: string): DxfLayerExtractionResult {
    const warnings: string[] = [];
    const proposals: DxfElementProposal[] = [];
    let dxf: any;
    try {
      const parser = new DxfParser();
      dxf = parser.parse(text);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Failed to parse DXF';
      this.logger.warn(`DXF parse failed: ${msg}`);
      return { proposals, warnings: [msg], layers: [] };
    }

    if (!dxf?.entities || !Array.isArray(dxf.entities)) {
      return { proposals, warnings: ['DXF has no entities'], layers: [] };
    }

    const counts = new Map<string, number>();
    for (const ent of dxf.entities) {
      const layer = (ent?.layer as string | undefined) || '0';
      counts.set(layer, (counts.get(layer) ?? 0) + 1);
    }

    const layers = Array.from(counts.keys()).sort();

    for (const [layer, count] of counts.entries()) {
      const match = this.matchLayer(layer);
      if (!match) continue;
      const level = this.matchLevel(layer) || fallbackLevel || '1F';
      proposals.push({
        level,
        block: null,
        elementType: match,
        qty: count,
        layer,
      });
    }

    if (proposals.length === 0) {
      warnings.push(
        'No structural layers detected. Expected layer names like 柱 / 大梁 / 小梁 / ブレース.',
      );
    }

    return { proposals, warnings, layers };
  }

  private matchLayer(layer: string): StructuralElementType | null {
    for (const [re, type] of this.LAYER_PATTERNS) {
      if (re.test(layer)) return type;
    }
    return null;
  }

  private matchLevel(layer: string): string | null {
    const m = this.LEVEL_RE.exec(layer);
    if (!m) return null;
    const raw = m[1].replace(/\s+/g, '').toUpperCase();
    if (raw === 'PH') return 'PH';
    if (raw === 'RF' || raw === 'R F' || raw === 'RFF') return 'R';
    if (raw.endsWith('F')) return raw;
    return `${raw}F`;
  }
}
