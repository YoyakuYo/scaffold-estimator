import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Estimate } from '../estimate/estimate.entity';

@Injectable()
export class ExcelGeneratorService {
  private readonly logger = new Logger(ExcelGeneratorService.name);

  async generateEstimate(estimate: Estimate, companyInfo: any): Promise<Buffer> {
    try {
      const workbook = new ExcelJS.Workbook();

      // Sheet 1: 見積概要
      this.createSummarySheet(workbook, estimate, companyInfo);

      // Sheet 2: 仮設材詳細
      this.createBOMSheet(workbook, estimate);

      // Sheet 3: 費用内訳
      this.createCostBreakdownSheet(workbook, estimate);

      // Sheet 4: 条件・注記
      this.createTermsSheet(workbook, estimate);

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Excel generation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  private createSummarySheet(
    workbook: ExcelJS.Workbook,
    estimate: Estimate,
    companyInfo: any,
  ) {
    const ws = workbook.addWorksheet('見積概要');

    // Header
    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = '仮設工事見積書';
    ws.getCell('A1').font = { size: 16, bold: true };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };

    // Company info
    ws.getCell('A3').value = '発行元:';
    ws.getCell('B3').value = companyInfo.name || '';
    ws.getCell('A4').value = '見積番号:';
    ws.getCell('B4').value = `EST-${estimate.id.substring(0, 8).toUpperCase()}`;
    ws.getCell('A5').value = '見積日:';
    ws.getCell('B5').value = estimate.createdAt;

    // Project info
    ws.getCell('A7').value = '工事名:';
    ws.getCell('B7').value = 'プロジェクト名';
    ws.getCell('A8').value = '構造種別:';
    ws.getCell('B8').value = estimate.structureType;
    ws.getCell('A9').value = '工期:';
    ws.getCell('B9').value = `${estimate.rentalStartDate} ～ ${estimate.rentalEndDate}`;

    // Total
    ws.getCell('A11').value = '合計金額:';
    ws.getCell('B11').value = estimate.totalEstimatedCost || 0;
    ws.getCell('B11').numFmt = '¥#,##0';
    ws.getCell('B11').font = { bold: true, size: 14 };

    // Set column widths
    ws.getColumn('A').width = 15;
    ws.getColumn('B').width = 30;
  }

  private createBOMSheet(workbook: ExcelJS.Workbook, estimate: Estimate) {
    const ws = workbook.addWorksheet('仮設材詳細');

    ws.columns = [
      { header: '部品名', key: 'name', width: 40 },
      { header: '数量', key: 'quantity', width: 15 },
      { header: '単位', key: 'unit', width: 10 },
      { header: '単価', key: 'unitPrice', width: 15 },
      { header: '小計', key: 'total', width: 15 },
    ];

    // Header row styling
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center' };

    // Add data
    estimate.billOfMaterials.components.forEach((comp) => {
      ws.addRow({
        name: comp.componentName,
        quantity: comp.quantity,
        unit: comp.unit,
        unitPrice: comp.unitPrice,
        total: comp.quantity * comp.unitPrice,
      });
    });

    // Format currency columns
    ws.getColumn('D').numFmt = '¥#,##0';
    ws.getColumn('E').numFmt = '¥#,##0';

    // Total row
    const totalRow = ws.addRow({
      name: '合計',
      quantity: '',
      unit: '',
      unitPrice: '',
      total: { formula: `SUM(E2:E${ws.rowCount})` },
    });
    totalRow.font = { bold: true };
    totalRow.getCell('E').numFmt = '¥#,##0';
  }

  private createCostBreakdownSheet(workbook: ExcelJS.Workbook, estimate: Estimate) {
    const ws = workbook.addWorksheet('費用内訳');

    ws.columns = [
      { header: '費目', key: 'name', width: 30 },
      { header: '金額', key: 'amount', width: 15 },
      { header: '摘要', key: 'note', width: 40 },
    ];

    // Header row styling
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { horizontal: 'center' };

    // Add cost line items
    if (estimate.costBreakdown && Array.isArray(estimate.costBreakdown)) {
      estimate.costBreakdown.forEach((item: any) => {
        ws.addRow({
          name: item.name,
          amount: item.isLocked && item.userEditedValue !== null
            ? item.userEditedValue
            : item.computedValue,
          note: item.editReason || item.formulaExpression || '',
        });
      });
    }

    // Format currency column
    ws.getColumn('B').numFmt = '¥#,##0';

    // Total row
    const totalRow = ws.addRow({
      name: '合計',
      amount: { formula: `SUM(B2:B${ws.rowCount})` },
      note: '',
    });
    totalRow.font = { bold: true };
    totalRow.getCell('B').numFmt = '¥#,##0';
  }

  private createTermsSheet(workbook: ExcelJS.Workbook, estimate: Estimate) {
    const ws = workbook.addWorksheet('条件・注記');

    ws.getCell('A1').value = '条件・注記';
    ws.getCell('A1').font = { size: 14, bold: true };

    ws.getCell('A3').value = '1. 上記金額は税込み価格です。';
    ws.getCell('A4').value = '2. 本見積書の有効期限は発行日より30日間です。';
    ws.getCell('A5').value = '3. 工期は天候等により変更となる場合があります。';
    ws.getCell('A6').value = '4. 詳細は別途協議の上決定いたします。';

    ws.getColumn('A').width = 80;
  }
}
