import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  ELEMENT_LINE_KINDS,
  STRUCTURAL_ELEMENT_TYPES,
  type ElementLineKind,
  type StructuralElementType,
} from '../element-types';

export interface ExcelImportRow {
  level: string;
  block: string | null;
  elementType: StructuralElementType;
  label: string | null;
  section: string | null;
  qty: number;
  /** Single-member length in millimetres (optional). */
  pieceLengthMm: number | null;
  phase: string | null;
  shop: string | null;
  lineKind: ElementLineKind;
  grid: string | null;
  notes: string | null;
}

export interface ExcelImportResult {
  rows: ExcelImportRow[];
  warnings: string[];
  /** Column-name → canonical-field map actually used (for diagnostics). */
  headerMap: Record<string, string>;
}

/**
 * Phase 3 — Mode 2: deterministic Excel/CSV element import.
 *
 * Reads an Excel/CSV upload from a steel fabricator (鉄骨数量表) and projects
 * it into the canonical extracted-element shape using a synonym map for the
 * Japanese / English column headers actually seen in practice.
 *
 * No AI is used. Rows that can't be confidently mapped land in `warnings`.
 */
@Injectable()
export class ExcelElementImportService {
  private readonly logger = new Logger(ExcelElementImportService.name);

  /** Header synonym map: canonical key → list of accepted column header tokens. */
  private readonly HEADER_SYNONYMS: Record<string, string[]> = {
    level: ['階', '階数', 'level', 'fl', 'floor', 'storey', 'story'],
    block: ['工区', 'ブロック', 'block', 'zone'],
    elementType: ['部材', '部材種別', '種別', '種類', 'type', 'element', '区分'],
    label: ['符号', '記号', 'mark', 'tag', 'id'],
    section: ['断面', 'section', 'spec', '形状', 'profile'],
    pieceLengthMm: [
      '長さmm',
      '長さ(mm)',
      '長さ',
      'piece_length_mm',
      'piecelength',
      'member length',
      '材長',
      '長さｍｍ',
    ],
    qty: ['数量', '個数', '本数', 'qty', 'quantity', 'count'],
    grid: ['通り芯', '通り', 'grid', 'axis'],
    phase: ['工程', 'フェーズ', 'phase', '工順'],
    shop: ['製作場', '工場', 'shop', 'fab', 'fabricator'],
    lineKind: ['行種', 'line_kind', 'linekind', '種別行', 'bolt/member'],
    notes: ['備考', 'note', 'notes', 'remarks', 'remark'],
  };

  /** Element-type label → canonical StructuralElementType. */
  private readonly ELEMENT_LABEL_MAP: Array<[RegExp, StructuralElementType]> = [
    [/^柱$|column|hashira|^c\b|柱材/i, 'hashira'],
    [/孫梁|magobari|まごばり/i, 'magobari'],
    [
      /片持ち?梁|cantilever(?:\s*beam|\s*girder)?|katamochibari|\bcg\d|\bcb\d|キャンチ/i,
      'katamochibari',
    ],
    [/大梁|main\s*beam|girder|oobari|大ばり/i, 'oobari'],
    [/小梁|small\s*beam|kobari|小ばり/i, 'kobari'],
    [/\b[Hh][Bb]\d|耐風梁|wind\s*beam|taifubari/i, 'taifubari'],
    [/ブレース|brace|bracing|筋交/i, 'brace'],
    [/階段|ステア|stair|kaidan|踊(り)?場|蹴込|stair\s*case/i, 'kaidan'],
    [
      /エレベーター|エレベータ|昇降機|elevator|^ev$|^elv$|elv\b|ev\s*shaft|機械室|シャフト製鉄/i,
      'elevator',
    ],
  ];

  async parseBuffer(buffer: Buffer, filename: string): Promise<ExcelImportResult> {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
      return this.parseCsv(buffer);
    }
    return this.parseXlsx(buffer);
  }

  // ─── CSV ────────────────────────────────────────────────────────

  private parseCsv(buffer: Buffer): ExcelImportResult {
    const text = buffer.toString('utf-8');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      return { rows: [], warnings: ['CSV has no data rows'], headerMap: {} };
    }
    const header = splitCsvLine(lines[0]);
    const headerMap = this.buildHeaderMap(header);
    const dataRows = lines.slice(1).map((l) => splitCsvLine(l));
    return this.assembleRows(header, headerMap, dataRows);
  }

  // ─── XLSX ────────────────────────────────────────────────────────

  private async parseXlsx(buffer: Buffer): Promise<ExcelImportResult> {
    const workbook = new ExcelJS.Workbook();
    // exceljs expects a Buffer<ArrayBuffer>; older Node Buffers are
    // `Buffer<ArrayBufferLike>`. Round-trip through Uint8Array → ArrayBuffer
    // copy so types align across Node versions.
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    await workbook.xlsx.load(Buffer.from(ab) as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { rows: [], warnings: ['No worksheet found'], headerMap: {} };
    }
    const rawRows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const last = row.cellCount;
      for (let i = 1; i <= last; i++) {
        const v = row.getCell(i).value;
        cells.push(this.cellToString(v));
      }
      rawRows.push(cells);
    });
    if (rawRows.length < 2) {
      return { rows: [], warnings: ['Sheet has no data rows'], headerMap: {} };
    }
    const header = rawRows[0];
    const headerMap = this.buildHeaderMap(header);
    const dataRows = rawRows.slice(1);
    return this.assembleRows(header, headerMap, dataRows);
  }

  private cellToString(v: ExcelJS.CellValue): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      const anyV = v as any;
      if (typeof anyV.text === 'string') return anyV.text;
      if (typeof anyV.result === 'string' || typeof anyV.result === 'number') return String(anyV.result);
      if (Array.isArray(anyV.richText)) return anyV.richText.map((r: any) => r.text).join('');
      if (anyV.error) return String(anyV.error);
    }
    try {
      return String(v);
    } catch {
      return '';
    }
  }

  // ─── Mapping ────────────────────────────────────────────────────

  private buildHeaderMap(header: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      const cell = (header[i] ?? '').trim().toLowerCase();
      if (!cell) continue;
      for (const [canonical, tokens] of Object.entries(this.HEADER_SYNONYMS)) {
        if (map[canonical]) continue; // first match wins
        for (const token of tokens) {
          const t = token.toLowerCase();
          if (cell === t || cell.includes(t)) {
            map[canonical] = String(i);
            break;
          }
        }
      }
    }
    return map;
  }

  private assembleRows(
    header: string[],
    headerMap: Record<string, string>,
    data: string[][],
  ): ExcelImportResult {
    const warnings: string[] = [];
    const rows: ExcelImportRow[] = [];

    if (!headerMap.elementType) {
      warnings.push(
        'Could not find element-type column (expected one of: 部材 / 部材種別 / type).',
      );
    }
    if (!headerMap.qty) warnings.push('Could not find quantity column (expected: 数量 / qty).');
    if (!headerMap.level) warnings.push('Could not find level column (expected: 階 / level / FL).');

    if (!headerMap.elementType || !headerMap.qty || !headerMap.level) {
      const labelByCol = header.reduce<Record<number, string>>((acc, h, i) => {
        acc[i] = h;
        return acc;
      }, {});
      return { rows, warnings: [...warnings, `headers: ${JSON.stringify(labelByCol)}`], headerMap };
    }

    const colLevel = Number(headerMap.level);
    const colBlock = headerMap.block !== undefined ? Number(headerMap.block) : null;
    const colType = Number(headerMap.elementType);
    const colLabel = headerMap.label !== undefined ? Number(headerMap.label) : null;
    const colSection = headerMap.section !== undefined ? Number(headerMap.section) : null;
    const colPieceLen =
      headerMap.pieceLengthMm !== undefined ? Number(headerMap.pieceLengthMm) : null;
    const colQty = Number(headerMap.qty);
    const colGrid = headerMap.grid !== undefined ? Number(headerMap.grid) : null;
    const colNotes = headerMap.notes !== undefined ? Number(headerMap.notes) : null;
    const colPhase = headerMap.phase !== undefined ? Number(headerMap.phase) : null;
    const colShop = headerMap.shop !== undefined ? Number(headerMap.shop) : null;
    const colLineKind = headerMap.lineKind !== undefined ? Number(headerMap.lineKind) : null;

    let rowIndex = 1;
    for (const dataRow of data) {
      rowIndex += 1;
      const get = (col: number | null): string => {
        if (col == null || col >= dataRow.length) return '';
        return (dataRow[col] ?? '').toString().trim();
      };
      const level = get(colLevel);
      if (!level) continue;
      const typeRaw = get(colType);
      const elementType = this.matchElementType(typeRaw);
      if (!elementType) {
        warnings.push(`Row ${rowIndex}: unknown element type "${typeRaw}"`);
        continue;
      }
      const qtyRaw = get(colQty).replace(/[, ]/g, '');
      const qty = Number.parseInt(qtyRaw, 10);
      if (!Number.isFinite(qty) || qty < 0) {
        warnings.push(`Row ${rowIndex}: invalid qty "${get(colQty)}"`);
        continue;
      }
      let pieceLengthMm: number | null = null;
      if (colPieceLen != null) {
        const lenRaw = get(colPieceLen).replace(/[, ]/g, '');
        const lenN = Number.parseFloat(lenRaw);
        if (Number.isFinite(lenN) && lenN > 0) {
          pieceLengthMm = Math.min(120_000, Math.max(1, Math.floor(lenN)));
        }
      }
      const lkRaw = colLineKind != null ? get(colLineKind).trim().toLowerCase() : '';
      const lineKind = (ELEMENT_LINE_KINDS as readonly string[]).includes(lkRaw)
        ? (lkRaw as ElementLineKind)
        : ('member' as ElementLineKind);

      rows.push({
        level: this.normalizeLevel(level),
        block: get(colBlock) || null,
        elementType,
        label: get(colLabel) || null,
        section: get(colSection) || null,
        qty,
        pieceLengthMm,
        phase:
          colPhase != null
            ? (() => {
                const p = get(colPhase).trim().slice(0, 200);
                return p || null;
              })()
            : null,
        shop:
          colShop != null
            ? (() => {
                const s = get(colShop).trim().slice(0, 200);
                return s || null;
              })()
            : null,
        lineKind,
        grid: get(colGrid) || null,
        notes: get(colNotes) || null,
      });
    }

    return { rows, warnings, headerMap };
  }

  private matchElementType(text: string): StructuralElementType | null {
    if (!text) return null;
    const trimmed = text.trim();
    for (const [re, type] of this.ELEMENT_LABEL_MAP) {
      if (re.test(trimmed)) return type;
    }
    // Last resort: exact canonical key match.
    const lower = trimmed.toLowerCase();
    if ((STRUCTURAL_ELEMENT_TYPES as readonly string[]).includes(lower)) {
      return lower as StructuralElementType;
    }
    return null;
  }

  private normalizeLevel(raw: string): string {
    const t = raw.trim();
    const m = t.match(/^(B?\d+|R|PH)\s*(?:F|階)?$/i);
    if (m) {
      const head = m[1].toUpperCase();
      if (head === 'R') return 'R';
      if (head === 'PH') return 'PH';
      if (head.startsWith('B')) return head;
      return `${head}F`;
    }
    if (/^\d+$/.test(t)) return `${t}F`;
    return t;
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}
