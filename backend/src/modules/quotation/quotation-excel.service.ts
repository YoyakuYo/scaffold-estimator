import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

/** Amount shown on quotation (manual override or formula). */
function effectiveCostLineAmount(item: {
  userEditedValue?: number | string | null;
  calculatedValue?: number | string | null;
}): number {
  const v = item.userEditedValue ?? item.calculatedValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(d: Date | string | undefined): string {
  if (d == null) return '';
  const x = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return String(d);
  return x.toISOString().slice(0, 10);
}

const STATUS_JA: Record<string, string> = {
  draft: '下書き',
  pending_review: '承認待ち',
  approved: '承認済',
  rejected: '却下',
  finalized: '確定済',
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};

const FILL_BANNER = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE2E8F0' } };
const FILL_LABEL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF1F5F9' } };
const FILL_HEADER_BLUE = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2563EB' } };
const FILL_HEADER_AMBER = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF59E0B' } };
const FILL_ALT_ROW = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF8FAFC' } };

const NUM_COLS = 7;

function scaffoldTypeJa(t?: string): string {
  if (t === 'kusabi') return 'くさび式足場';
  if (t === 'wakugumi') return '枠組足場';
  return t ? String(t) : '';
}

function endStopperJa(t?: string): string {
  if (t === 'nuno' || t === 'frame') return '端部';
  return t ? String(t) : '';
}

function quantityNumFmt(q: number): string {
  if (Number.isInteger(q)) return '#,##0';
  return '#,##0.###';
}

function displayOrDash(v: string | number | null | undefined): string {
  if (v == null) return '—';
  const s = String(v).trim();
  return s.length ? s : '—';
}

export type QuotationLike = {
  id: string;
  status: string;
  rentalStartDate?: Date | string;
  rentalEndDate?: Date | string;
  rentalType?: string;
  materialSubtotal?: number | string;
  costSubtotal?: number | string;
  subtotal?: number | string;
  taxAmount?: number | string;
  totalAmount?: number | string;
  createdAt?: Date | string;
  items?: Array<{
    componentName?: string;
    sizeSpec?: string;
    unit?: string;
    quantity?: number | string;
    unitPrice?: number | string;
    lineTotal?: number | string;
    sortOrder?: number;
  }>;
  costItems?: Array<{
    name?: string;
    formulaExpression?: string;
    calculatedValue?: number | string | null;
    userEditedValue?: number | string | null;
    sortOrder?: number;
  }>;
  config?: {
    structureType?: string;
    scaffoldType?: string;
    buildingHeightMm?: number;
    scaffoldWidthMm?: number;
    siteName?: string | null;
    siteAddress?: string | null;
    siteEmail?: string | null;
    sitePhone?: string | null;
    siteFax?: string | null;
    preferredMainTatejiMm?: number;
    frameSizeMm?: number;
    habakiCountPerSpan?: number;
    endStopperType?: string;
    wakugumiFrameSeries?: string;
    drawing?: { filename?: string };
  };
};

@Injectable()
export class QuotationExcelService {
  async generateBudgetWorkbook(quotation: QuotationLike): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Scaffold Estimator';
    wb.created = new Date();
    const ws = wb.addWorksheet('見積書', {
      views: [{ showGridLines: true }],
      pageSetup: {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    const yenFmt = '#,##0';
    let row = 1;
    const cfg = quotation.config;

    const mergeRowBanner = (text: string, fill: ExcelJS.Fill) => {
      ws.mergeCells(row, 1, row, NUM_COLS);
      const c = ws.getCell(row, 1);
      c.value = text;
      c.font = { bold: true, size: 11 };
      c.fill = fill;
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      for (let col = 1; col <= NUM_COLS; col++) {
        ws.getCell(row, col).border = BORDER_THIN as ExcelJS.Borders;
      }
      row++;
    };

    const addLabelValueRow = (label: string, value: string | number | undefined) => {
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 1).font = { bold: true, size: 10 };
      ws.getCell(row, 1).fill = FILL_LABEL;
      ws.getCell(row, 1).alignment = { vertical: 'middle', wrapText: true };
      ws.getCell(row, 1).border = BORDER_THIN as ExcelJS.Borders;
      ws.mergeCells(row, 2, row, NUM_COLS);
      const v = ws.getCell(row, 2);
      v.value = value ?? '';
      v.alignment = { vertical: 'middle', wrapText: true };
      for (let col = 2; col <= NUM_COLS; col++) {
        ws.getCell(row, col).border = BORDER_THIN as ExcelJS.Borders;
      }
      row++;
    };

    // ─── Document title ───
    ws.mergeCells(row, 1, row, NUM_COLS);
    const titleCell = ws.getCell(row, 1);
    titleCell.value = '足場 見積書（予算）';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let col = 1; col <= NUM_COLS; col++) {
      ws.getCell(row, col).border = BORDER_THIN as ExcelJS.Borders;
    }
    ws.getRow(row).height = 28;
    row++;

    row++;

    // ─── Site / contact (from scaffold config) ───
    mergeRowBanner('工事情報・現場連絡先', FILL_BANNER);
    addLabelValueRow('現場名', displayOrDash(cfg?.siteName));
    addLabelValueRow('住所', displayOrDash(cfg?.siteAddress));
    addLabelValueRow('メール', displayOrDash(cfg?.siteEmail));
    addLabelValueRow('電話', displayOrDash(cfg?.sitePhone));
    addLabelValueRow('FAX', displayOrDash(cfg?.siteFax));

    row++;

    // ─── Scaffold + quotation meta ───
    mergeRowBanner('足場条件・見積概要', FILL_BANNER);
    addLabelValueRow('見積番号', quotation.id.substring(0, 8).toUpperCase());
    addLabelValueRow('ステータス', STATUS_JA[quotation.status] ?? quotation.status);
    addLabelValueRow('作成日', formatDate(quotation.createdAt));
    if (cfg?.structureType) {
      addLabelValueRow('構造種別', String(cfg.structureType));
    }
    if (cfg?.scaffoldType) {
      addLabelValueRow('足場種別', scaffoldTypeJa(cfg.scaffoldType));
    }
    if (cfg?.scaffoldWidthMm != null) {
      addLabelValueRow('足場幅', `${cfg.scaffoldWidthMm} mm`);
    }
    if (cfg?.buildingHeightMm != null) {
      addLabelValueRow('建物高さ（代表）', `${cfg.buildingHeightMm.toLocaleString('ja-JP')} mm`);
    }
    if (cfg?.scaffoldType === 'kusabi' && cfg.preferredMainTatejiMm != null) {
      addLabelValueRow('支柱（主桁）', `${cfg.preferredMainTatejiMm} mm`);
    }
    if (cfg?.scaffoldType === 'wakugumi') {
      if (cfg.frameSizeMm != null) {
        addLabelValueRow('建枠（段高）', `${cfg.frameSizeMm} mm`);
      }
      if (cfg.wakugumiFrameSeries) {
        addLabelValueRow('枠組シリーズ', String(cfg.wakugumiFrameSeries));
      }
      if (cfg.habakiCountPerSpan != null) {
        addLabelValueRow('巾木（1スパン）', `${cfg.habakiCountPerSpan} 枚`);
      }
      if (cfg.endStopperType) {
        addLabelValueRow('端部', endStopperJa(cfg.endStopperType));
      }
    }
    if (cfg?.drawing?.filename) {
      addLabelValueRow('図面ファイル', cfg.drawing.filename);
    }
    addLabelValueRow(
      'レンタル期間',
      `${formatDate(quotation.rentalStartDate)} ～ ${formatDate(quotation.rentalEndDate)}`,
    );
    addLabelValueRow('レンタル種別', displayOrDash(quotation.rentalType));

    row++;

    // ─── 見積項目（材料） ───
    mergeRowBanner('見積項目（材料）', FILL_BANNER);

    const itemCols = ['No.', '部材名', '規格', '単位', '数量', '単価 (¥)', '行計 (¥)'] as const;
    itemCols.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = FILL_HEADER_BLUE;
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: true };
      c.border = BORDER_THIN as ExcelJS.Borders;
    });
    row++;

    const sortedItems = [...(quotation.items ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    sortedItems.forEach((item, idx) => {
      const fill = idx % 2 === 1 ? FILL_ALT_ROW : undefined;
      const q = Number(item.quantity);
      const qty = Number.isFinite(q) ? q : 0;

      const cells: { col: number; value: ExcelJS.CellValue; numFmt?: string; align: Partial<ExcelJS.Alignment> }[] = [
        { col: 1, value: idx + 1, align: { horizontal: 'center' } },
        { col: 2, value: item.componentName ?? '', align: { horizontal: 'left', wrapText: true } },
        { col: 3, value: item.sizeSpec ?? '', align: { horizontal: 'left', wrapText: true } },
        { col: 4, value: item.unit ?? '', align: { horizontal: 'center' } },
        { col: 5, value: qty, numFmt: quantityNumFmt(qty), align: { horizontal: 'right' } },
        { col: 6, value: Math.round(Number(item.unitPrice) || 0), numFmt: yenFmt, align: { horizontal: 'right' } },
        { col: 7, value: Math.round(Number(item.lineTotal) || 0), numFmt: yenFmt, align: { horizontal: 'right' } },
      ];
      for (const { col, value, numFmt, align } of cells) {
        const c = ws.getCell(row, col);
        c.value = value;
        if (numFmt) c.numFmt = numFmt;
        c.alignment = { vertical: 'middle', ...align };
        if (fill) c.fill = fill;
        c.border = BORDER_THIN as ExcelJS.Borders;
      }
      row++;
    });

    ws.getColumn(1).width = 7;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 24;
    ws.getColumn(4).width = 10;
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 14;
    ws.getColumn(7).width = 14;

    row += 1;

    // ─── レンタル費用 ───
    const costs = [...(quotation.costItems ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    if (costs.length > 0) {
      mergeRowBanner('レンタル・諸費用', FILL_BANNER);

      const h1 = ws.getCell(row, 1);
      h1.value = 'No.';
      h1.font = { bold: true, color: { argb: 'FF1F2937' } };
      h1.fill = FILL_HEADER_AMBER;
      h1.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      h1.border = BORDER_THIN as ExcelJS.Borders;

      const h2 = ws.getCell(row, 2);
      h2.value = '費用名';
      h2.font = { bold: true, color: { argb: 'FF1F2937' } };
      h2.fill = FILL_HEADER_AMBER;
      h2.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      h2.border = BORDER_THIN as ExcelJS.Borders;

      ws.mergeCells(row, 3, row, 6);
      const h3 = ws.getCell(row, 3);
      h3.value = '計算式';
      h3.font = { bold: true, color: { argb: 'FF1F2937' } };
      h3.fill = FILL_HEADER_AMBER;
      h3.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      for (let col = 3; col <= 6; col++) {
        ws.getCell(row, col).border = BORDER_THIN as ExcelJS.Borders;
      }

      const h7 = ws.getCell(row, 7);
      h7.value = '金額 (¥)';
      h7.font = { bold: true, color: { argb: 'FF1F2937' } };
      h7.fill = FILL_HEADER_AMBER;
      h7.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
      h7.border = BORDER_THIN as ExcelJS.Borders;
      row++;

      costs.forEach((cost, idx) => {
        ws.getCell(row, 1).value = idx + 1;
        ws.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getCell(row, 1).border = BORDER_THIN as ExcelJS.Borders;

        ws.getCell(row, 2).value = cost.name ?? '';
        ws.getCell(row, 2).alignment = { vertical: 'middle', wrapText: true };
        ws.getCell(row, 2).border = BORDER_THIN as ExcelJS.Borders;

        ws.mergeCells(row, 3, row, 6);
        ws.getCell(row, 3).value = cost.formulaExpression ?? '';
        ws.getCell(row, 3).alignment = { wrapText: true, vertical: 'middle' };
        for (let col = 3; col <= 6; col++) {
          ws.getCell(row, col).border = BORDER_THIN as ExcelJS.Borders;
        }

        const amt = Math.round(effectiveCostLineAmount(cost));
        ws.getCell(row, 7).value = amt;
        ws.getCell(row, 7).numFmt = yenFmt;
        ws.getCell(row, 7).alignment = { horizontal: 'right', vertical: 'middle' };
        ws.getCell(row, 7).border = BORDER_THIN as ExcelJS.Borders;
        row++;
      });
      row += 1;
    }

    // ─── 合計 ───
    mergeRowBanner('集計', FILL_BANNER);

    const totals: [string, number, boolean][] = [
      ['資材小計 (¥)', Math.round(Number(quotation.materialSubtotal) || 0), false],
      ['レンタル費用小計 (¥)', Math.round(Number(quotation.costSubtotal) || 0), false],
      ['小計 (¥)', Math.round(Number(quotation.subtotal) || 0), false],
      ['消費税 10% (¥)', Math.round(Number(quotation.taxAmount) || 0), false],
      ['合計 (¥)', Math.round(Number(quotation.totalAmount) || 0), true],
    ];

    for (const [label, value, isGrand] of totals) {
      const lc = ws.getCell(row, 1);
      lc.value = label;
      lc.font = { bold: true, size: isGrand ? 12 : 10 };
      lc.alignment = { vertical: 'middle' };
      lc.border = BORDER_THIN as ExcelJS.Borders;
      if (isGrand) lc.fill = FILL_LABEL;

      ws.mergeCells(row, 2, row, NUM_COLS);
      const v = ws.getCell(row, 2);
      v.value = value;
      v.numFmt = yenFmt;
      v.font = { bold: isGrand, size: isGrand ? 12 : 10 };
      v.alignment = { horizontal: 'right', vertical: 'middle' };
      if (isGrand) v.fill = FILL_LABEL;
      for (let col = 2; col <= NUM_COLS; col++) {
        ws.getCell(row, col).border = BORDER_THIN as ExcelJS.Borders;
      }
      row++;
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
