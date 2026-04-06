/**
 * Premium schedule import: JSON manifest, CSV, or span-configuration text lines.
 * Applies to wall lengths already aligned with polygon edge order.
 */

export const PREMIUM_SCHEDULE_JSON_VERSION = 1;

export interface PremiumScheduleImportResult {
  version: number;
  wallLengthsMm: number[];
  edgeLabels?: string[];
  baysMmByEdge?: Record<string, number[]>;
  source: 'json' | 'csv' | 'txt';
  warnings: string[];
}

const EDGE_LINE_RE =
  /^\s*([A-Za-z]{1,4})\s*\/\s*.+?\(([^)]+)\)\s*$/;
const SPAN_TERM_RE = /(\d+(?:\.\d+)?)\s*m?\s*[×x]\s*(\d+)/gi;

function parseSpanTermsInParens(inner: string): { lengthMm: number; count: number }[] {
  const terms: { lengthMm: number; count: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(SPAN_TERM_RE.source, 'gi');
  while ((m = re.exec(inner)) !== null) {
    const len = parseFloat(m[1]);
    const count = parseInt(m[2], 10);
    if (!Number.isFinite(len) || !Number.isFinite(count) || count < 1) continue;
    const mm = len <= 45 ? Math.round(len * 1000) : Math.round(len);
    terms.push({ lengthMm: mm, count });
  }
  return terms;
}

function sumSpanTerms(terms: { lengthMm: number; count: number }[]): number {
  return terms.reduce((s, t) => s + t.lengthMm * t.count, 0);
}

/** Expand repeated bays for optional BOM / display. */
function expandBays(terms: { lengthMm: number; count: number }[]): number[] {
  const out: number[] = [];
  for (const t of terms) {
    for (let i = 0; i < t.count; i++) out.push(t.lengthMm);
  }
  return out;
}

/**
 * Parse lines like:
 * AB / X1–X8 (7 spans 1.829m×1 1.219m×1 0.914m×5)
 */
export function parseSpanConfigurationText(content: string): {
  edgeLabels: string[];
  wallLengthsMm: number[];
  baysMmByEdge: Record<string, number[]>;
  warnings: string[];
} {
  const edgeLabels: string[] = [];
  const wallLengthsMm: number[] = [];
  const baysMmByEdge: Record<string, number[]> = {};
  const warnings: string[] = [];

  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^span\s+configuration/i.test(line)) continue;
    const match = line.match(EDGE_LINE_RE);
    if (!match) {
      warnings.push(`Skipped line (unrecognized): ${line.slice(0, 80)}`);
      continue;
    }
    const label = match[1].toUpperCase();
    const inner = match[2];
    const terms = parseSpanTermsInParens(inner);
    if (terms.length === 0) {
      warnings.push(`No span terms in line for ${label}`);
      continue;
    }
    const total = sumSpanTerms(terms);
    if (total < 600) {
      warnings.push(`Length too small for ${label} (${total}mm) — check units`);
      continue;
    }
    edgeLabels.push(label);
    wallLengthsMm.push(Math.round(total));
    baysMmByEdge[label] = expandBays(terms);
  }

  return { edgeLabels, wallLengthsMm, baysMmByEdge, warnings };
}

function normalizeMm(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v < 200) return Math.round(v * 1000);
  return Math.round(v);
}

function parseJson(content: string): PremiumScheduleImportResult {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error(
      'Invalid JSON. Expected v1 manifest with wallLengthsMm[] or spanConfigurationLines. / JSON が不正です',
    );
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('JSON root must be an object');
  }
  const o = data as Record<string, unknown>;
  const version = typeof o.version === 'number' ? o.version : PREMIUM_SCHEDULE_JSON_VERSION;
  let wallLengthsMm: number[] = [];
  let edgeLabels: string[] | undefined;
  let baysMmByEdge: Record<string, number[]> | undefined;

  if (Array.isArray(o.wallLengthsMm)) {
    wallLengthsMm = o.wallLengthsMm.map((x) => normalizeMm(Number(x))).filter((x) => x >= 600);
    if (wallLengthsMm.length !== o.wallLengthsMm.length) {
      warnings.push('Some wallLengthsMm entries were dropped (< 600mm or non-numeric)');
    }
  }

  if (Array.isArray(o.edgeLabels)) {
    edgeLabels = o.edgeLabels.map((x) => String(x).toUpperCase().trim());
  }

  if (o.baysMmByEdge && typeof o.baysMmByEdge === 'object') {
    baysMmByEdge = {};
    for (const [k, v] of Object.entries(o.baysMmByEdge as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      baysMmByEdge[k.toUpperCase()] = v.map((n) => normalizeMm(Number(n))).filter((x) => x > 0);
    }
  }

  if (typeof o.spanConfigurationText === 'string' && o.spanConfigurationText.trim()) {
    const parsed = parseSpanConfigurationText(o.spanConfigurationText);
    warnings.push(...parsed.warnings);
    if (parsed.wallLengthsMm.length > 0) {
      wallLengthsMm = parsed.wallLengthsMm;
      edgeLabels = parsed.edgeLabels;
      baysMmByEdge = { ...baysMmByEdge, ...parsed.baysMmByEdge };
    }
  }

  if (Array.isArray(o.spanConfigurationLines)) {
    const text = (o.spanConfigurationLines as unknown[])
      .map((x) => String(x))
      .join('\n');
    const parsed = parseSpanConfigurationText(text);
    warnings.push(...parsed.warnings);
    if (parsed.wallLengthsMm.length > 0) {
      wallLengthsMm = parsed.wallLengthsMm;
      edgeLabels = parsed.edgeLabels;
      baysMmByEdge = { ...baysMmByEdge, ...parsed.baysMmByEdge };
    }
  }

  if (wallLengthsMm.length < 3) {
    throw new Error(
      'JSON must include at least 3 wall lengths (wallLengthsMm or spanConfigurationLines). / 辺の長さが3未満です',
    );
  }

  return {
    version,
    wallLengthsMm,
    edgeLabels,
    baysMmByEdge,
    source: 'json',
    warnings,
  };
}

function parseCsv(content: string): PremiumScheduleImportResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('Empty CSV');

  let start = 0;
  const head = lines[0].toLowerCase();
  if (head.includes('edge') && head.includes('length')) start = 1;

  const edgeLabels: string[] = [];
  const wallLengthsMm: number[] = [];

  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',').map((s) => s.trim());
    if (parts.length < 2) {
      warnings.push(`CSV row ${i + 1}: need edge,length`);
      continue;
    }
    const label = parts[0].toUpperCase();
    const lenRaw = parseFloat(parts[1].replace(/mm$/i, '').trim());
    const mm = normalizeMm(lenRaw);
    if (mm < 600) {
      warnings.push(`CSV row ${i + 1}: length too small`);
      continue;
    }
    edgeLabels.push(label);
    wallLengthsMm.push(mm);
  }

  if (wallLengthsMm.length < 3) {
    throw new Error('CSV must have at least 3 valid rows (edge,lengthMm or edge,length_m)');
  }

  return {
    version: PREMIUM_SCHEDULE_JSON_VERSION,
    wallLengthsMm,
    edgeLabels,
    source: 'csv',
    warnings,
  };
}

export function parsePremiumScheduleBuffer(
  buffer: Buffer,
  filename?: string,
): PremiumScheduleImportResult {
  const ext = filename?.includes('.')
    ? '.' + filename.split('.').pop()!.toLowerCase()
    : '';
  const text = buffer.toString('utf-8').replace(/^\uFEFF/, '');

  if (ext === '.csv') {
    return parseCsv(text);
  }
  if (ext === '.json') {
    return parseJson(text);
  }
  if (ext === '.txt') {
    const parsed = parseSpanConfigurationText(text);
    if (parsed.wallLengthsMm.length < 3) {
      throw new Error(
        'Could not parse span lines from .txt (need AB / X1–X8 (7 spans …) format)',
      );
    }
    return {
      version: PREMIUM_SCHEDULE_JSON_VERSION,
      wallLengthsMm: parsed.wallLengthsMm,
      edgeLabels: parsed.edgeLabels,
      baysMmByEdge: parsed.baysMmByEdge,
      source: 'txt',
      warnings: parsed.warnings,
    };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return parseJson(text);
  }
  if (trimmed.startsWith('AB') || trimmed.toLowerCase().includes('span configuration')) {
    const parsed = parseSpanConfigurationText(text);
    if (parsed.wallLengthsMm.length >= 3) {
      return {
        version: PREMIUM_SCHEDULE_JSON_VERSION,
        wallLengthsMm: parsed.wallLengthsMm,
        edgeLabels: parsed.edgeLabels,
        baysMmByEdge: parsed.baysMmByEdge,
        source: 'txt',
        warnings: parsed.warnings,
      };
    }
  }

  try {
    return parseCsv(text);
  } catch {
    /* fallthrough */
  }

  throw new Error(
    'Unsupported schedule file. Use .json (manifest), .csv (edge,lengthMm), or .txt (span configuration lines). / 対応形式: json, csv, txt',
  );
}
