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
  config?: { structureType?: string; scaffoldType?: string; drawing?: { filename?: string } };
};

@Injectable()
export class QuotationExcelService {
  async generateBudgetWorkbook(quotation: QuotationLike): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Scaffold Estimator';
    const ws = wb.addWorksheet('見積書', {
      views: [{ showGridLines: true }],
    });

    const yenFmt = '#,##0';
    let row = 1;

    const setLabelValue = (label: string, value: string | number | undefined) => {
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 2).value = value ?? '';
      row++;
    };

    setLabelValue('見積番号', quotation.id.substring(0, 8).toUpperCase());
    setLabelValue('ステータス', STATUS_JA[quotation.status] ?? quotation.status);
    setLabelValue('作成日', formatDate(quotation.createdAt));
    if (quotation.config?.structureType) {
      setLabelValue('構造', String(quotation.config.structureType));
    }
    if (quotation.config?.scaffoldType) {
      setLabelValue('足場種別', String(quotation.config.scaffoldType));
    }
    if (quotation.config?.drawing?.filename) {
      setLabelValue('図面', quotation.config.drawing.filename);
    }
    setLabelValue(
      'レンタル期間',
      `${formatDate(quotation.rentalStartDate)} ～ ${formatDate(quotation.rentalEndDate)}`,
    );
    setLabelValue('レンタル種別', quotation.rentalType ?? '');

    row += 1;

    // ─── 見積項目 ───
    ws.getCell(row, 1).value = '見積項目（材料）';
    ws.getCell(row, 1).font = { bold: true, size: 12 };
    row++;

    const itemCols = ['No.', '部材名', '規格', '単位', '数量', '単価 (¥)', '行計 (¥)'] as const;
    itemCols.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF7' } };
    });
    row++;

    const sortedItems = [...(quotation.items ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    sortedItems.forEach((item, idx) => {
      ws.getCell(row, 1).value = idx + 1;
      ws.getCell(row, 2).value = item.componentName ?? '';
      ws.getCell(row, 3).value = item.sizeSpec ?? '';
      ws.getCell(row, 4).value = item.unit ?? '';
      ws.getCell(row, 5).value = Number(item.quantity) || 0;
      ws.getCell(row, 5).numFmt = '#,##0.###';
      ws.getCell(row, 6).value = Math.round(Number(item.unitPrice) || 0);
      ws.getCell(row, 6).numFmt = yenFmt;
      ws.getCell(row, 7).value = Math.round(Number(item.lineTotal) || 0);
      ws.getCell(row, 7).numFmt = yenFmt;
      row++;
    });

    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 28;
    ws.getColumn(3).width = 22;
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
      ws.getCell(row, 1).value = 'レンタル・諸費用';
      ws.getCell(row, 1).font = { bold: true, size: 12 };
      row++;

      ['No.', '費用名', '計算式', '金額 (¥)'].forEach((h, i) => {
        const c = ws.getCell(row, i + 1);
        c.value = h;
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8D7' } };
      });
      row++;

      costs.forEach((cost, idx) => {
        ws.getCell(row, 1).value = idx + 1;
        ws.getCell(row, 2).value = cost.name ?? '';
        ws.getCell(row, 3).value = cost.formulaExpression ?? '';
        ws.getCell(row, 3).alignment = { wrapText: true };
        const amt = Math.round(effectiveCostLineAmount(cost));
        ws.getCell(row, 4).value = amt;
        ws.getCell(row, 4).numFmt = yenFmt;
        row++;
      });
      row += 1;
    }

    // ─── 合計 ───
    ws.getCell(row, 1).value = '集計';
    ws.getCell(row, 1).font = { bold: true, size: 12 };
    row++;

    const totals: [string, number][] = [
      ['資材小計 (¥)', Math.round(Number(quotation.materialSubtotal) || 0)],
      ['レンタル費用小計 (¥)', Math.round(Number(quotation.costSubtotal) || 0)],
      ['小計 (¥)', Math.round(Number(quotation.subtotal) || 0)],
      ['消費税 10% (¥)', Math.round(Number(quotation.taxAmount) || 0)],
      ['合計 (¥)', Math.round(Number(quotation.totalAmount) || 0)],
    ];

    for (const [label, value] of totals) {
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 1).font = { bold: label.startsWith('合計') };
      ws.getCell(row, 2).value = value;
      ws.getCell(row, 2).numFmt = yenFmt;
      if (label.startsWith('合計')) {
        ws.getCell(row, 1).font = { bold: true, size: 12 };
        ws.getCell(row, 2).font = { bold: true, size: 12 };
      }
      row++;
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
