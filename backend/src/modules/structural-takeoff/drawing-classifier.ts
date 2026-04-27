/**
 * Phase 3 — deterministic filename-based classifier.
 *
 * Japanese structural-engineering drawings follow consistent naming
 * patterns (per JASS / standard CAD layer rules). This module identifies
 * the floor/block/kind purely from filename text — no AI required.
 *
 * If patterns are absent, the file is left as `kind='unknown'` and the user
 * resolves it on the review screen.
 */
import type { DrawingKind } from './element-types';

export interface DrawingClassification {
  kind: DrawingKind;
  level: string | null;
  block: string | null;
  confidence: number;
}

const CLEAN_BASENAME_RE = /\.[^./\\]+$/;

function cleanBasename(filename: string): string {
  // Drop directory components and last extension.
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(CLEAN_BASENAME_RE, '');
}

const FLOOR_PATTERNS: Array<[RegExp, string]> = [
  // Latin "1F", "2FL", "B1F", "RF", "PH"
  [/(?:^|[^A-Z0-9])(B[1-9])\s*F/i, 'B$1'],
  [/(?:^|[^A-Z0-9])(R)\s*F/i, 'R'],
  [/(?:^|[^A-Z0-9])(PH|P\.?H\.?)\b/i, 'PH'],
  [/(?:^|[^A-Z0-9])([1-9][0-9]?)\s*F(?:L)?/i, '$1F'],
  // Japanese 階 patterns: 1階, 2階, R階, B1階, 屋階
  [/(B[1-9])階/, 'B$1'],
  [/([1-9][0-9]?)階/, '$1F'],
  [/(屋階|R階|RF階)/, 'R'],
];

function matchFloor(text: string): string | null {
  for (const [re, repl] of FLOOR_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const out = m[0].replace(re, repl);
      if (out.startsWith('B')) return out.slice(0, 2).toUpperCase();
      if (out === '屋階' || out === 'R階' || out === 'RF階') return 'R';
      const norm = out.replace(/F[L]?$/i, 'F').toUpperCase();
      return norm;
    }
  }
  return null;
}

const BLOCK_PATTERNS: RegExp[] = [
  /(?:^|[^A-Z])([A-D])\s*工区/,
  /(?:^|[^A-Z])(?:Block|BLK|BLOCK)\s*([A-D])/i,
  /(?:^|[^A-Z])工区\s*([A-D])/,
];

function matchBlock(text: string): string | null {
  for (const re of BLOCK_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function matchKind(text: string): { kind: DrawingKind; confidence: number } {
  const lower = text.toLowerCase();
  if (/柱リスト|柱表|column[\s_-]?list/.test(lower)) {
    return { kind: 'column_list', confidence: 0.95 };
  }
  if (/大梁リスト|小梁リスト|梁リスト|梁表|beam[\s_-]?list|girder[\s_-]?list/.test(lower)) {
    return { kind: 'beam_list', confidence: 0.95 };
  }
  if (/階段|stair/.test(lower) && /(詳細|detail|elevation|平面)/.test(lower)) {
    return { kind: 'stair_detail', confidence: 0.85 };
  }
  if (/階段/.test(lower)) {
    return { kind: 'stair_detail', confidence: 0.7 };
  }
  if (/エレベーター|エレベータ|elevator|ev[\s_-]?shaft|ev詳細/.test(lower)) {
    return { kind: 'elevator_shaft', confidence: 0.85 };
  }
  if (/階高表|level[\s_-]?diagram|level[\s_-]?list/.test(lower)) {
    return { kind: 'level_diagram', confidence: 0.9 };
  }
  if (/伏図|framing[\s_-]?plan|構造平面|structural[\s_-]?plan|fukuzu/.test(lower)) {
    return { kind: 'framing_plan', confidence: 0.9 };
  }
  if (/立面|elevation/.test(lower) || /平面|plan/.test(lower)) {
    return { kind: 'general', confidence: 0.5 };
  }
  return { kind: 'unknown', confidence: 0.3 };
}

export function classifyDrawingFilename(filename: string): DrawingClassification {
  const base = cleanBasename(filename);
  const kindMatch = matchKind(base);
  const level = matchFloor(base);
  const block = matchBlock(base);
  // Boost confidence when both kind + level matched.
  const bonus = kindMatch.kind !== 'unknown' && level ? 0.05 : 0;
  return {
    kind: kindMatch.kind,
    level,
    block,
    confidence: Math.min(1, kindMatch.confidence + bonus),
  };
}
