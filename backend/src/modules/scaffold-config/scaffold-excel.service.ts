import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { ScaffoldCalculationResult, WallCalculationResult, CalculatedComponent } from './scaffold-calculator.service';

/**
 * Generates a printable Excel quotation (足場材料見積書)
 * with per-wall columns, Japanese material names, categories, and unit column.
 */
@Injectable()
export class ScaffoldExcelService {
  private readonly logger = new Logger(ScaffoldExcelService.name);

  async generateQuotation(config: ScaffoldConfiguration): Promise<Buffer> {
    const result: ScaffoldCalculationResult = config.calculationResult;
    if (!result) throw new Error('No calculation result available');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Zoomen Reader';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('足場材料見積書', {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    // Total columns: No + 分類 + 部材名 + 規格 + 単位 + walls... + 合計
    const totalCols = 5 + result.walls.length + 1;

    // ─── Title ────────────────────────────────────────────
    const scaffoldTypeLabel = (result.scaffoldType === 'wakugumi') ? '枠組足場' : 'くさび式足場';
    const titleRow = sheet.addRow([`${scaffoldTypeLabel} 材料見積書`]);
    titleRow.font = { bold: true, size: 18 };
    sheet.mergeCells(1, 1, 1, totalCols);
    titleRow.alignment = { horizontal: 'center' };
    sheet.addRow([]);

    // ─── Config Summary ──────────────────────────────────
    const scaffoldType = result.scaffoldType || 'kusabi';
    const isWakugumi = scaffoldType === 'wakugumi';
    const maxHeight = Math.max(...result.walls.map(w => w.levelCalc.topPlankHeightMm + w.levelCalc.topGuardHeightMm), 0);

    sheet.addRow(['足場タイプ', isWakugumi ? '枠組足場 (Wakugumi)' : 'くさび式足場 (Kusabi)']);
    sheet.addRow(['最大建物高さ', `${maxHeight}mm`]);
    sheet.addRow(['足場幅', `${result.scaffoldWidthMm}mm`]);

    if (isWakugumi) {
      sheet.addRow(['建枠サイズ', `${result.frameSizeMm || 1700}mm`]);
      sheet.addRow(['巾木枚数', `${result.habakiCountPerSpan || 2}枚/スパン`]);
      sheet.addRow(['端部タイプ', result.endStopperType === 'frame' ? '枠タイプ (妻側枠)' : '布材タイプ (端部布材)']);
    } else {
      sheet.addRow(['支柱サイズ', `${result.preferredMainTatejiMm}mm`]);
      sheet.addRow(['上部支柱', `${result.topGuardHeightMm}mm`]);
    }

    sheet.addRow(['段数', `${result.totalLevels}段`]);
    const levelHeightMm = isWakugumi ? (result.frameSizeMm || 1800) : 1800;
    sheet.addRow(['階高', `${levelHeightMm}mm`]);
    sheet.addRow([]);

    // ─── Wall dimensions (length & height per side) ───────
    sheet.addRow(['壁面寸法']);
    const dimHeader = sheet.addRow(['面', '壁長 (mm)', '足場高さ (mm)', '段数']);
    dimHeader.font = { bold: true };
    for (const w of result.walls) {
      const scaffoldH = w.levelCalc.topPlankHeightMm + w.levelCalc.topGuardHeightMm;
      sheet.addRow([w.sideJp, w.wallLengthMm, scaffoldH, w.levelCalc.fullLevels]);
    }
    sheet.addRow([]);

    // ─── Floor labels (1階, 2階, ... with height range) ───
    sheet.addRow(['階（フロア）']);
    const floorHeader = sheet.addRow(['階', '高さ範囲 (mm)', '備考']);
    floorHeader.font = { bold: true };
    for (let f = 1; f <= result.totalLevels; f++) {
      const from = (f - 1) * levelHeightMm;
      const to = f * levelHeightMm;
      const label = f === 1 ? '1階' : f === 2 ? '2階' : f === 3 ? '3階' : `${f}階`;
      sheet.addRow([label, `${from} ～ ${to}`, f === 1 ? '1st floor' : f === 2 ? '2nd floor' : `${f}th floor`]);
    }
    sheet.addRow([]);

    // ─── Material Table Header ───────────────────────────
    const wallNames = result.walls.map(w => w.sideJp);
    const headerRow = sheet.addRow([
      'No',
      '分類',
      '部材名',
      '規格',
      '単位',
      ...wallNames,
      '合計',
    ]);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Style header cells
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // ─── Material Rows ───────────────────────────────────
    // Build wall maps for per-wall quantities
    const wallMaps: Map<string, number>[] = result.walls.map(wall => {
      const m = new Map<string, number>();
      for (const comp of wall.components) {
        const key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        m.set(key, (m.get(key) || 0) + comp.quantity);
      }
      return m;
    });

    // Sort summary by category, then by sortOrder to ensure proper grouping
    const sortedSummary = [...result.summary].sort((a, b) => {
      const catA = a.category || '';
      const catB = b.category || '';
      if (catA !== catB) {
        return catA.localeCompare(catB, 'ja');
      }
      return a.sortOrder - b.sortOrder;
    });

    let rowNum = 1;
    let lastCategory = '';

    for (const comp of sortedSummary) {
      const key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
      // Category separator row
      const cat = comp.category || '';
      if (cat !== lastCategory) {
        const catRow = sheet.addRow([]);
        catRow.getCell(1).value = '';
        catRow.getCell(2).value = `【${cat}】`;
        catRow.getCell(2).font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
        catRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF3F4F6' },
          };
          cell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
          };
        });
        lastCategory = cat;
      }

      const perWallQty = wallMaps.map(m => m.get(key) || 0);
      const total = comp.materialCode === 'PATTANKO' ? comp.quantity : perWallQty.reduce((a, b) => a + b, 0);

      const dataRow = sheet.addRow([
        rowNum,
        comp.category || '',
        comp.nameJp,
        comp.sizeSpec,
        comp.unit,
        ...perWallQty,
        total,
      ]);

      // Center-align number columns
      dataRow.getCell(1).alignment = { horizontal: 'center' };
      dataRow.getCell(5).alignment = { horizontal: 'center' };
      for (let i = 0; i < result.walls.length + 1; i++) {
        dataRow.getCell(6 + i).alignment = { horizontal: 'center' };
      }

      // Alternate row colors
      if (rowNum % 2 === 0) {
        dataRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDBEAFE' },
          };
        });
      }

      // Borders for all cells
      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Bold total column
      const totalCell = dataRow.getCell(6 + result.walls.length);
      totalCell.font = { bold: true };
      totalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF6FF' },
      };

      rowNum++;
    }

    // ─── Per-wall span info ──────────────────────────────
    sheet.addRow([]);
    sheet.addRow([]);
    const spanInfoTitle = sheet.addRow(['スパン構成']);
    spanInfoTitle.font = { bold: true, size: 14 };

    for (const wall of result.walls) {
      const spanSummary = this.summarizeSpans(wall.spans);
      sheet.addRow([
        wall.sideJp,
        `壁長: ${wall.wallLengthMm}mm`,
        `スパン数: ${wall.totalSpans}`,
        `階段: ${wall.stairAccessCount}箇所`,
        `構成: ${spanSummary}`,
      ]);
    }

    // ─── Sheet 2: Per-floor, per-side breakdown (for transport) ──
    const sheet2 = workbook.addWorksheet('階・面別内訳', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const wallNames2 = result.walls.map(w => w.sideJp);
    const numCorners = result.walls.length;
    const levelH = levelHeightMm;

    for (let floor = 1; floor <= result.totalLevels; floor++) {
      const floorLabel = floor === 1 ? '1階' : floor === 2 ? '2階' : `${floor}階`;
      const rangeLabel = `${(floor - 1) * levelH}～${floor * levelH}mm`;
      sheet2.addRow([]);
      const titleRow = sheet2.addRow([`${floorLabel} (${rangeLabel}) — 積算内訳（運搬用）`]);
      titleRow.font = { bold: true, size: 12 };
      sheet2.mergeCells(titleRow.number, 1, titleRow.number, wallNames2.length + 3);
      const subHeader = sheet2.addRow(['部材名', '規格', ...wallNames2, '角部', '合計']);
      subHeader.font = { bold: true };
      subHeader.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });

      for (const comp of sortedSummary) {
        const key = comp.materialCode || (comp.category === '布材' ? `${comp.category}-${comp.sizeSpec}` : `${comp.type}-${comp.sizeSpec}`);
        const perWallQty = wallMaps.map(m => m.get(key) || 0);
        const isPattanko = comp.materialCode === 'PATTANKO';
        const perWallPerLevel = result.walls.map((w, i) => {
          const L = w.levelCalc.fullLevels;
          if (L <= 0) return 0;
          if (isPattanko) return 0;
          return Math.round((perWallQty[i] || 0) / L);
        });
        const cornerPerLevel = isPattanko ? numCorners * 2 : 0;
        const rowTotal = perWallPerLevel.reduce((a, b) => a + b, 0) + cornerPerLevel;
        if (rowTotal <= 0) continue;
        sheet2.addRow([
          comp.nameJp,
          comp.sizeSpec,
          ...perWallPerLevel,
          isPattanko ? cornerPerLevel : '',
          rowTotal,
        ]);
      }
    }

    sheet2.getColumn(1).width = 22;
    sheet2.getColumn(2).width = 14;
    for (let i = 0; i < wallNames2.length + 2; i++) sheet2.getColumn(3 + i).width = 10;

    // ─── Column Widths ───────────────────────────────────
    sheet.getColumn(1).width = 5;    // No
    sheet.getColumn(2).width = 12;   // 分類
    sheet.getColumn(3).width = 18;   // 部材名
    sheet.getColumn(4).width = 20;   // 規格
    sheet.getColumn(5).width = 7;    // 単位
    for (let i = 0; i < result.walls.length; i++) {
      sheet.getColumn(6 + i).width = 10;
    }
    sheet.getColumn(6 + result.walls.length).width = 10; // 合計

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private summarizeSpans(spans: number[]): string {
    const groups: Record<number, number> = {};
    for (const s of spans) {
      groups[s] = (groups[s] || 0) + 1;
    }
    return Object.entries(groups)
      .map(([size, count]) => `${size}mm×${count}`)
      .join(' + ');
  }
}
