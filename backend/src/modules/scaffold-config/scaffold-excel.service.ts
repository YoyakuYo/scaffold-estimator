import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { ScaffoldCalculationResult, WallCalculationResult, CalculatedComponent } from './scaffold-calculator.service';
import { edgeChordNameExcel, resolveEdgeHashiraXY, type EdgeHashiraLabeling } from './excel-edge-hashira';
import {
  aggregateLevelQtyToFloors,
  buildingFloorCountFromHeight,
  distributeByScaffoldLevel,
} from './material-breakdown-excel.util';
import { compareCalculatedComponentsForBom } from './scaffold-bom-sort';

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

    // ─── Site / contact (optional) ─────────────────────────
    const siteRows: [string, string][] = [];
    if (config.siteName) siteRows.push(['現場名 / 件名', config.siteName]);
    if (config.siteAddress) siteRows.push(['住所', config.siteAddress]);
    if (config.siteEmail) siteRows.push(['メール', config.siteEmail]);
    if (config.sitePhone) siteRows.push(['電話', config.sitePhone]);
    if (config.siteFax) siteRows.push(['FAX', config.siteFax]);
    for (const [k, v] of siteRows) {
      sheet.addRow([k, v]);
    }
    if (siteRows.length > 0) sheet.addRow([]);

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

    const sortedSummary = this.sortSummaryForExcel(result.summary);
    const materialGroups = this.groupSummaryByMaterialForExcel(sortedSummary);

    let rowNum = 1;
    let lastCategory = '';

    const applyDetailRowStyle = (dataRow: ExcelJS.Row, n: number, wallsLen: number) => {
      dataRow.getCell(1).alignment = { horizontal: 'center' };
      dataRow.getCell(5).alignment = { horizontal: 'center' };
      for (let i = 0; i < wallsLen + 1; i++) {
        dataRow.getCell(6 + i).alignment = { horizontal: 'center' };
      }
      if (n % 2 === 0) {
        dataRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDBEAFE' },
          };
        });
      }
      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
      const totalCell = dataRow.getCell(6 + wallsLen);
      totalCell.font = { bold: true };
      totalCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF6FF' },
      };
    };

    for (const grp of materialGroups) {
      const cat = grp.category || '';
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

      const multi = grp.components.length > 1;
      if (multi) {
        const banner = sheet.addRow([`【${cat}】${grp.nameJp}（${grp.unit}）— 規格別数量`]);
        sheet.mergeCells(banner.number, 1, banner.number, totalCols);
        banner.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
        banner.getCell(1).alignment = { vertical: 'middle', wrapText: true };
        banner.getCell(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE5E7EB' },
        };
        banner.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        });
      }

      for (let i = 0; i < grp.components.length; i++) {
        const comp = grp.components[i];
        const mapKey = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        const perWallQty = wallMaps.map((m) => m.get(mapKey) || 0);
        const total =
          comp.materialCode === 'PATTANKO'
            ? comp.quantity
            : perWallQty.reduce((a, b) => a + b, 0);
        const catCol = multi && i > 0 ? '〃' : cat;
        const nameCol = multi && i > 0 ? '〃' : comp.nameJp;

        const dataRow = sheet.addRow([
          rowNum,
          catCol,
          nameCol,
          comp.sizeSpec || '',
          comp.unit,
          ...perWallQty,
          total,
        ]);
        applyDetailRowStyle(dataRow, rowNum, result.walls.length);
        rowNum++;
      }
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
        const mapKey = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        const perWallQty = wallMaps.map((m) => m.get(mapKey) || 0);
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
          comp.sizeSpec || '',
          ...perWallPerLevel,
          isPattanko ? cornerPerLevel : '',
          rowTotal,
        ]);
      }
    }

    sheet2.getColumn(1).width = 22;
    sheet2.getColumn(2).width = 14;
    for (let i = 0; i < wallNames2.length + 2; i++) sheet2.getColumn(3 + i).width = 10;

    this.appendSpecMatrixByWall(workbook, result, wallMaps);
    this.appendMaterialBreakdownSheet(workbook, config, result);

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

  /**
   * Third sheet: 材料明細 — matches result-page Material Breakdown (per edge, floor columns, UTF-8).
   */
  private appendMaterialBreakdownSheet(
    workbook: ExcelJS.Workbook,
    config: ScaffoldConfiguration,
    result: ScaffoldCalculationResult,
  ): void {
    const walls = result.walls;
    if (!walls?.length) return;

    const sheet = workbook.addWorksheet('材料明細', {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    const scaffoldType = result.scaffoldType || 'kusabi';
    const isWakugumi = scaffoldType === 'wakugumi';
    const levelHeightMm = isWakugumi ? (result.frameSizeMm || 1800) : 1800;
    const buildingHeightMm =
      config.buildingHeightMm ?? Math.max(3000, ...walls.map((w) => w.wallHeightMm ?? 0));
    const buildingFloorCount = buildingFloorCountFromHeight(buildingHeightMm);
    const scaffoldLevelCount = Math.max(
      1,
      result.totalLevels || Math.ceil(buildingHeightMm / levelHeightMm),
    );
    const totalLevels = Math.max(1, result.totalLevels ?? scaffoldLevelCount);

    const poly = (result as { polygonVertices?: unknown[] }).polygonVertices;
    const closedFootprint = Array.isArray(poly) && poly.length >= 3;
    const labeling = (result as { edgeHashiraLabeling?: EdgeHashiraLabeling }).edgeHashiraLabeling;

    const totalCols = 5 + buildingFloorCount + 3;

    const titleRow = sheet.addRow(['材料明細']);
    titleRow.font = { bold: true, size: 16 };
    sheet.mergeCells(1, 1, 1, totalCols);
    titleRow.alignment = { horizontal: 'center' };
    sheet.addRow([]);

    const metaRow = sheet.addRow([
      `建物高さ: ${(buildingHeightMm / 1000).toFixed(1)}m`,
      `足場幅: ${result.scaffoldWidthMm}mm`,
      `段数: ${totalLevels}`,
      `推定階数: ${buildingFloorCount}`,
      `壁面数: ${walls.length}`,
    ]);
    metaRow.font = { size: 10 };
    sheet.mergeCells(metaRow.number, 1, metaRow.number, totalCols);
    sheet.addRow([]);

    const floorLabels = Array.from({ length: buildingFloorCount }, (_, i) => `${i + 1}階`);
    const headerRow = sheet.addRow([
      '線',
      '通り',
      '部材名',
      '規格',
      '単位',
      ...floorLabels,
      '合計',
      '単価(¥)',
      '金額(¥)',
    ]);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    type MatrixRow = {
      wallIndex: number;
      nameJp: string;
      spec: string;
      unit: string;
      floorQty: number[];
      total: number;
    };
    const matrixRows: MatrixRow[] = [];

    for (let wi = 0; wi < walls.length; wi++) {
      const wall = walls[wi];
      const wallLevels = wall.levelCalc?.fullLevels || 1;
      for (const comp of wall.components) {
        const levelQty = distributeByScaffoldLevel(comp, wallLevels, scaffoldLevelCount);
        const floorQty = aggregateLevelQtyToFloors(levelQty, levelHeightMm, buildingFloorCount);
        matrixRows.push({
          wallIndex: wi,
          nameJp: comp.nameJp || comp.name || comp.type,
          spec: comp.sizeSpec || '-',
          unit: comp.unit || '-',
          floorQty,
          total: floorQty.reduce((s, n) => s + n, 0),
        });
      }
    }

    for (let wi = 0; wi < walls.length; wi++) {
      const wall = walls[wi];
      const chord = edgeChordNameExcel(wi, walls.length, closedFootprint);
      const sectionText =
        `辺 ${chord} — ${wall.wallLengthMm.toLocaleString()} mm` +
        `  |  スパン: ${wall.totalSpans} · 段数: ${wall.levelCalc?.fullLevels ?? 1} · 高さ: ${(wall.wallHeightMm ?? 0).toLocaleString()} mm · 階段: ${wall.stairAccessCount ?? 0}箇所`;

      const secRow = sheet.addRow([sectionText]);
      secRow.font = { bold: true, size: 11 };
      sheet.mergeCells(secRow.number, 1, secRow.number, totalCols);
      secRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      secRow.getCell(1).alignment = { vertical: 'middle', wrapText: true };

      const xy = resolveEdgeHashiraXY(labeling, wi, walls.length, wall.sideJp ?? '', wall.side ?? '');
      const alongOne =
        xy.alongRange ||
        (xy.alongStations.length > 0
          ? `${xy.alongStations[0]}–${xy.alongStations[xy.alongStations.length - 1]}`
          : '');
      if (xy.crossLabel || alongOne) {
        const hRow = sheet.addRow([
          xy.crossLabel ?? '',
          alongOne || '',
          '',
          '',
          '',
          ...Array(buildingFloorCount + 3).fill(''),
        ]);
        hRow.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        });
      }

      const wallRows = matrixRows.filter((r) => r.wallIndex === wi);
      for (const row of wallRows) {
        const dataRow = sheet.addRow([
          '',
          '',
          row.nameJp,
          row.spec,
          row.unit,
          ...row.floorQty,
          row.total,
          '',
          '',
        ]);
        const totalCol = 6 + buildingFloorCount;
        dataRow.getCell(totalCol).font = { bold: true };
        dataRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          if (colNumber >= 6 && colNumber <= totalCol) {
            cell.alignment = { horizontal: 'right' };
          }
        });
      }
    }

    const floorSums = Array.from({ length: buildingFloorCount }, (_, idx) =>
      matrixRows.reduce((acc, r) => acc + (r.floorQty[idx] || 0), 0),
    );
    const grandTotal = matrixRows.reduce((s, r) => s + r.total, 0);
    const sumRow = sheet.addRow([
      '',
      '',
      '合計',
      '',
      '',
      ...floorSums,
      grandTotal,
      '',
      '',
    ]);
    sumRow.font = { bold: true };
    sumRow.eachCell((cell, colNumber) => {
      cell.border = {
        top: { style: 'medium' },
        left: { style: 'thin' },
        bottom: { style: 'medium' },
        right: { style: 'thin' },
      };
      if (colNumber >= 6) cell.alignment = { horizontal: 'right' };
    });

    sheet.getColumn(1).width = 10;
    sheet.getColumn(2).width = 14;
    sheet.getColumn(3).width = 24;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 8;
    for (let c = 6; c <= totalCols; c++) {
      sheet.getColumn(c).width = c <= 5 + buildingFloorCount ? 10 : 12;
    }
  }

  private sortSummaryForExcel(summary: CalculatedComponent[]): CalculatedComponent[] {
    return [...summary].sort(compareCalculatedComponentsForBom);
  }

  private groupSummaryByMaterialForExcel(
    sorted: CalculatedComponent[],
  ): Array<{ category: string; nameJp: string; unit: string; components: CalculatedComponent[] }> {
    const gk = (c: CalculatedComponent) =>
      `${c.category || ''}\t${c.nameJp || ''}\t${c.unit || ''}`;
    const out: Array<{ category: string; nameJp: string; unit: string; components: CalculatedComponent[] }> = [];
    for (const comp of sorted) {
      const prev = out[out.length - 1];
      if (prev && gk(prev.components[0]) === gk(comp)) {
        prev.components.push(comp);
      } else {
        out.push({
          category: comp.category || '',
          nameJp: comp.nameJp,
          unit: comp.unit,
          components: [comp],
        });
      }
    }
    return out;
  }

  /**
   * One sheet per request: each material (部材名+単位) as a block with 規格 × 壁面 columns.
   */
  private appendSpecMatrixByWall(
    workbook: ExcelJS.Workbook,
    result: ScaffoldCalculationResult,
    wallMaps: Map<string, number>[],
  ): void {
    const walls = result.walls;
    if (!walls?.length) return;

    const sheet = workbook.addWorksheet('規格別・面別', {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    const wallNames = walls.map((w) => w.sideJp);
    const ncol = 2 + walls.length;

    const titleRow = sheet.addRow(['規格別・面別数量（壁面ごとの規格内訳）']);
    titleRow.font = { bold: true, size: 14 };
    sheet.mergeCells(titleRow.number, 1, titleRow.number, ncol);
    titleRow.getCell(1).alignment = { horizontal: 'left' };
    sheet.addRow([]);

    const sorted = this.sortSummaryForExcel(result.summary);
    const groups = this.groupSummaryByMaterialForExcel(sorted);

    for (const grp of groups) {
      const blockTitle = sheet.addRow([`【${grp.category}】${grp.nameJp}（${grp.unit}）`]);
      blockTitle.font = { bold: true, size: 11 };
      sheet.mergeCells(blockTitle.number, 1, blockTitle.number, ncol);
      blockTitle.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      const h = sheet.addRow(['規格', ...wallNames, '合計']);
      h.font = { bold: true };
      h.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      for (const comp of grp.components) {
        const mapKey = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        const perWall = wallMaps.map((m) => m.get(mapKey) || 0);
        const total =
          comp.materialCode === 'PATTANKO'
            ? comp.quantity
            : perWall.reduce((a, b) => a + b, 0);
        const dataRow = sheet.addRow([comp.sizeSpec || '-', ...perWall, total]);
        dataRow.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          if (colNumber >= 2) cell.alignment = { horizontal: 'right' };
        });
      }

      sheet.addRow([]);
    }

    sheet.getColumn(1).width = 20;
    for (let i = 0; i < walls.length; i++) {
      sheet.getColumn(2 + i).width = 11;
    }
    sheet.getColumn(2 + walls.length).width = 11;
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
