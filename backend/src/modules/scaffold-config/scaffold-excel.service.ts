import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ScaffoldConfiguration } from './scaffold-config.entity';
import { ScaffoldCalculationResult, CalculatedComponent } from './scaffold-calculator.service';
import {
  edgeChordNameExcel,
  excelQuotationWallColumnHeader,
  resolveEdgeHashiraXY,
  type EdgeHashiraLabeling,
} from './excel-edge-hashira';
import {
  aggregateLevelQtyToFloors,
  buildingFloorCountFromHeight,
  distributeByScaffoldLevel,
} from './material-breakdown-excel.util';
import { compareCalculatedComponentsForBom } from './scaffold-bom-sort';
import {
  type ExcelExportLocale,
  excelCategory,
  excelMaterialName,
  getScaffoldExcelStrings,
  normalizeExcelLocale,
  type ScaffoldExcelStrings,
} from './scaffold-excel-i18n';

const FILL_HEADER = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2563EB' } };
const FILL_SECTION = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE5E7EB' } };
const FILL_ALT = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF8FAFC' } };
const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

type BreakdownMatrixRow = {
  wallIndex: number;
  groupKey: string;
  categoryDisplay: string;
  nameDisplay: string;
  bomSort: { type: string; sortOrder: number; sizeSpec: string };
  spec: string;
  unit: string;
  floorQty: number[];
  total: number;
};

/**
 * Single worksheet: site header, spans, localized overall totals, floor aggregate, per-edge × floor.
 */
@Injectable()
export class ScaffoldExcelService {
  async generateQuotation(config: ScaffoldConfiguration, lang?: string): Promise<Buffer> {
    const result: ScaffoldCalculationResult = config.calculationResult;
    if (!result) throw new Error('No calculation result available');

    const walls = result.walls;
    if (!walls.length) throw new Error('No walls in calculation result');

    const locale = normalizeExcelLocale(lang);
    const str = getScaffoldExcelStrings(locale);

    const wallColumnHeaders = this.buildExcelWallColumnHeaders(result);
    const ctx = this.buildBreakdownContext(config, result, locale);
    const { matrixRows, buildingFloorCount, levelHeightMm } = ctx;

    const floorSectionCols = 5 + buildingFloorCount + 1;
    const layoutMergeCols = Math.max(floorSectionCols, 10);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Zoomen Reader';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(str.sheetName.slice(0, 31), {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    const docTitle =
      result.scaffoldType === 'wakugumi' ? str.docTitleWakugumi : str.docTitleKusabi;
    const titleRow = sheet.addRow([docTitle]);
    titleRow.font = { bold: true, size: 20 };
    titleRow.height = 28;
    sheet.mergeCells(titleRow.number, 1, titleRow.number, layoutMergeCols);
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.addRow([]);
    this.writeSiteContactGrid(sheet, config, layoutMergeCols, str);
    this.writeGlobalSpecBanner(sheet, result, layoutMergeCols, levelHeightMm, str);

    sheet.addRow([]);
    this.writeSectionBanner(sheet, str.sectionSpans, layoutMergeCols);
    this.writeSpansTable(sheet, result, wallColumnHeaders, str);

    const wallMaps: Map<string, number>[] = walls.map((wall) => {
      const m = new Map<string, number>();
      for (const comp of wall.components) {
        const key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        m.set(key, (m.get(key) || 0) + comp.quantity);
      }
      return m;
    });

    const sortedSummary = this.sortSummaryForExcel(result.summary);
    const materialGroups = this.groupSummaryByMaterialForExcel(sortedSummary);

    sheet.addRow([]);
    this.writeSectionBanner(sheet, str.sectionOverall, layoutMergeCols);
    this.writeOverallTotalsTable(sheet, materialGroups, wallMaps, str, locale);

    sheet.addRow([]);
    this.writeSectionBanner(sheet, str.sectionFloorAggregate, layoutMergeCols);
    this.writeProjectWideFloorTable(sheet, matrixRows, buildingFloorCount, str);

    sheet.addRow([]);
    this.writeSectionBanner(sheet, str.sectionEdgeFloor, layoutMergeCols);
    this.writePerEdgeFloorTables(sheet, result, ctx, str);

    const colCount = Math.max(layoutMergeCols, floorSectionCols);
    for (let c = 1; c <= colCount; c++) {
      sheet.getColumn(c).width = c <= 5 ? [6, 14, 26, 18, 8][c - 1] ?? 12 : 11;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private mergeBanner(sheet: ExcelJS.Worksheet, row: ExcelJS.Row, throughCol: number) {
    if (throughCol > 1) sheet.mergeCells(row.number, 1, row.number, throughCol);
    const cell = row.getCell(1);
    cell.fill = FILL_SECTION;
    cell.font = { bold: true, size: 12 };
    cell.alignment = { vertical: 'middle', wrapText: true };
    for (let c = 1; c <= throughCol; c++) {
      row.getCell(c).border = BORDER_THIN as ExcelJS.Borders;
    }
  }

  private writeSiteContactGrid(
    sheet: ExcelJS.Worksheet,
    config: ScaffoldConfiguration,
    mergeCols: number,
    str: ScaffoldExcelStrings,
  ) {
    const boxTitle = sheet.addRow([str.siteContactTitle]);
    this.mergeBanner(sheet, boxTitle, Math.min(mergeCols, 10));
    boxTitle.getCell(1).font = { bold: true, size: 11 };

    const rows: [string, string][] = [
      [str.siteName, config.siteName || str.empty],
      [str.address, config.siteAddress || str.empty],
      [str.phone, config.sitePhone || str.empty],
      [str.email, config.siteEmail || str.empty],
      [str.fax, config.siteFax || str.empty],
    ];

    for (const [label, value] of rows) {
      const r = sheet.addRow([label, value]);
      r.getCell(1).font = { bold: true, size: 10 };
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      r.getCell(1).alignment = { vertical: 'middle', wrapText: true };
      r.getCell(1).border = BORDER_THIN as ExcelJS.Borders;
      r.getCell(2).alignment = { vertical: 'middle', wrapText: true };
      r.getCell(2).border = BORDER_THIN as ExcelJS.Borders;
      sheet.mergeCells(r.number, 2, r.number, Math.min(mergeCols, 10));
    }
    sheet.getColumn(1).width = 14;
    sheet.getColumn(2).width = 52;
  }

  private writeGlobalSpecBanner(
    sheet: ExcelJS.Worksheet,
    result: ScaffoldCalculationResult,
    mergeCols: number,
    levelHeightMm: number,
    str: ScaffoldExcelStrings,
  ) {
    const isWk = result.scaffoldType === 'wakugumi';
    const maxH = Math.max(
      ...result.walls.map((w) => w.levelCalc.topPlankHeightMm + w.levelCalc.topGuardHeightMm),
      0,
    );
    const typeLabel = isWk ? str.specScaffoldTypeWakugumi : str.specScaffoldTypeKusabi;
    const parts = [
      typeLabel,
      `${str.specWidth} ${result.scaffoldWidthMm}mm`,
      `${str.specLevels} ${result.totalLevels}`,
      `${str.specLevelHeight} ${levelHeightMm}mm`,
      `${str.specMaxHeight} ${maxH}mm`,
    ];
    if (isWk) {
      parts.push(
        `${str.specFrame} ${result.frameSizeMm || 1700}mm`,
        `${str.specHabakiPerSpan} ${result.habakiCountPerSpan || 2}/span`,
      );
    } else {
      parts.push(`${str.specPost} ${result.preferredMainTatejiMm}mm`, `${str.specTop} ${result.topGuardHeightMm}mm`);
    }
    const r = sheet.addRow([parts.join('  |  ')]);
    r.font = { size: 10 };
    sheet.mergeCells(r.number, 1, r.number, mergeCols);
    r.getCell(1).alignment = { vertical: 'middle', wrapText: true };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    r.getCell(1).border = BORDER_THIN as ExcelJS.Borders;
  }

  private writeSectionBanner(sheet: ExcelJS.Worksheet, title: string, mergeCols: number) {
    const r = sheet.addRow([title]);
    this.mergeBanner(sheet, r, mergeCols);
  }

  private writeSpansTable(
    sheet: ExcelJS.Worksheet,
    result: ScaffoldCalculationResult,
    wallLabels: string[],
    str: ScaffoldExcelStrings,
  ) {
    const hdr = sheet.addRow([
      str.colEdgeLabel,
      str.colSpanCount,
      str.colSpanDetail,
      str.colWallLengthMm,
    ]);
    this.styleHeaderRowFull(hdr, 1, 4);
    for (let wi = 0; wi < result.walls.length; wi++) {
      const w = result.walls[wi];
      const summary = this.summarizeSpans(w.spans, str);
      const dr = sheet.addRow([wallLabels[wi], w.totalSpans, summary, w.wallLengthMm]);
      this.styleDataRowFull(dr, 1, 4, [2, 3]);
      dr.getCell(1).alignment = { vertical: 'middle', wrapText: true };
      dr.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      if (wi % 2 === 1) {
        for (let c = 1; c <= 4; c++) dr.getCell(c).fill = FILL_ALT;
      }
    }
  }

  private styleHeaderRowFull(row: ExcelJS.Row, from: number, to: number) {
    for (let c = from; c <= to; c++) {
      const cell = row.getCell(c);
      cell.fill = FILL_HEADER;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BORDER_THIN as ExcelJS.Borders;
    }
  }

  private styleDataRowFull(row: ExcelJS.Row, from: number, to: number, centerCols: number[]) {
    const set = new Set(centerCols);
    for (let c = from; c <= to; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER_THIN as ExcelJS.Borders;
      cell.alignment = {
        horizontal: set.has(c) ? 'center' : 'right',
        vertical: 'middle',
        wrapText: true,
      };
    }
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  private writeOverallTotalsTable(
    sheet: ExcelJS.Worksheet,
    materialGroups: Array<{ category: string; nameJp: string; unit: string; components: CalculatedComponent[] }>,
    wallMaps: Map<string, number>[],
    str: ScaffoldExcelStrings,
    locale: ExcelExportLocale,
  ) {
    const cols = 6;
    const hdr = sheet.addRow([
      str.colNo,
      str.colCategory,
      str.colName,
      str.colSpec,
      str.colUnit,
      str.colTotal,
    ]);
    this.styleHeaderRowFull(hdr, 1, cols);

    let rowNum = 1;
    let lastCat = '';
    let prevCatDisplay = '';
    let prevNameDisplay = '';
    let prevSpec = '';

    for (const grp of materialGroups) {
      const cat = grp.category || '';
      if (cat !== lastCat) {
        const band = sheet.addRow([]);
        const catLabel = excelCategory(grp.components[0], locale);
        band.getCell(2).value = catLabel ? `【${catLabel}】` : '';
        band.getCell(2).font = { bold: true, size: 10 };
        for (let c = 1; c <= cols; c++) {
          band.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
          band.getCell(c).border = BORDER_THIN as ExcelJS.Borders;
        }
        sheet.mergeCells(band.number, 2, band.number, cols);
        lastCat = cat;
      }

      for (const comp of grp.components) {
        const mapKey = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        const perWall = wallMaps.map((m) => m.get(mapKey) || 0);
        const total =
          comp.materialCode === 'PATTANKO' ? comp.quantity : perWall.reduce((a, b) => a + b, 0);
        const catD = excelCategory(comp, locale);
        const nameD = excelMaterialName(comp, locale);
        const specRaw = comp.sizeSpec || '';
        const catCell =
          catD === prevCatDisplay && prevCatDisplay !== '' ? str.sameAsAbove : catD;
        const nameCell =
          nameD === prevNameDisplay && prevNameDisplay !== '' ? str.sameAsAbove : nameD;
        const specCell =
          specRaw === prevSpec &&
          prevSpec !== '' &&
          catD === prevCatDisplay &&
          nameD === prevNameDisplay
            ? str.sameAsAbove
            : specRaw;
        prevCatDisplay = catD;
        prevNameDisplay = nameD;
        prevSpec = specRaw;

        const dr = sheet.addRow([rowNum, catCell, nameCell, specCell, comp.unit, total]);
        for (let c = 1; c <= cols; c++) {
          dr.getCell(c).border = BORDER_THIN as ExcelJS.Borders;
        }
        dr.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        dr.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        dr.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        dr.getCell(4).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        dr.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
        dr.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };
        dr.getCell(6).font = { bold: true };
        if (rowNum % 2 === 0) {
          for (let c = 1; c <= cols; c++) dr.getCell(c).fill = FILL_ALT;
        }
        rowNum++;
      }
    }
  }

  private writeProjectWideFloorTable(
    sheet: ExcelJS.Worksheet,
    matrixRows: BreakdownMatrixRow[],
    buildingFloorCount: number,
    str: ScaffoldExcelStrings,
  ) {
    const floorLabels = Array.from({ length: buildingFloorCount }, (_, i) => str.floorN(i + 1));
    const nCol = 5 + buildingFloorCount + 1;
    const hdr = sheet.addRow([
      str.colCategory,
      str.colMaterialName,
      str.colSpec,
      str.colUnit,
      ...floorLabels,
      str.colTotal,
    ]);
    this.styleHeaderRowFull(hdr, 1, nCol);

    const merged = this.aggregateMatrixRowsByMaterial(matrixRows);
    let ri = 0;
    for (const row of merged) {
      const dr = sheet.addRow([
        row.categoryDisplay,
        row.nameDisplay,
        row.spec,
        row.unit,
        ...row.floorQty,
        row.total,
      ]);
      for (let c = 1; c <= nCol; c++) {
        dr.getCell(c).border = BORDER_THIN as ExcelJS.Borders;
      }
      dr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      dr.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      dr.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      dr.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      for (let c = 5; c <= nCol; c++) {
        dr.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      dr.getCell(nCol).font = { bold: true };
      if (ri % 2 === 1) {
        for (let c = 1; c <= nCol; c++) dr.getCell(c).fill = FILL_ALT;
      }
      ri++;
    }

    const floorSums = Array.from({ length: buildingFloorCount }, (_, idx) =>
      merged.reduce((acc, r) => acc + (r.floorQty[idx] || 0), 0),
    );
    const grand = merged.reduce((s, r) => s + r.total, 0);
    const sumRow = sheet.addRow(['', '', '', str.sumLabel, ...floorSums, grand]);
    sumRow.font = { bold: true };
    for (let c = 1; c <= nCol; c++) {
      sumRow.getCell(c).border = {
        top: { style: 'medium' },
        left: { style: 'thin' },
        bottom: { style: 'medium' },
        right: { style: 'thin' },
      };
      if (c >= 5) sumRow.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
    }
  }

  private aggregateMatrixRowsByMaterial(
    matrixRows: BreakdownMatrixRow[],
  ): Array<{
    categoryDisplay: string;
    nameDisplay: string;
    spec: string;
    unit: string;
    floorQty: number[];
    total: number;
  }> {
    type Agg = {
      categoryDisplay: string;
      nameDisplay: string;
      spec: string;
      unit: string;
      floorQty: number[];
      total: number;
      bomSort: { type: string; sortOrder: number; sizeSpec: string };
    };
    const map = new Map<string, Agg>();

    for (const r of matrixRows) {
      const key = `${r.groupKey}\t${r.spec}`;
      const existing = map.get(key);
      if (existing) {
        for (let i = 0; i < existing.floorQty.length; i++) {
          existing.floorQty[i] += r.floorQty[i] || 0;
        }
        existing.total += r.total;
      } else {
        map.set(key, {
          categoryDisplay: r.categoryDisplay,
          nameDisplay: r.nameDisplay,
          spec: r.spec,
          unit: r.unit,
          floorQty: [...r.floorQty],
          total: r.total,
          bomSort: r.bomSort,
        });
      }
    }

    const list = Array.from(map.values()).sort((a, b) => compareCalculatedComponentsForBom(a.bomSort, b.bomSort));
    return list.map(({ bomSort: _b, ...rest }) => rest);
  }

  private buildBreakdownContext(
    config: ScaffoldConfiguration,
    result: ScaffoldCalculationResult,
    locale: ExcelExportLocale,
  ) {
    const walls = result.walls;
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

    const matrixRows: BreakdownMatrixRow[] = [];
    for (let wi = 0; wi < walls.length; wi++) {
      const wall = walls[wi];
      const wallLevels = wall.levelCalc?.fullLevels || 1;
      for (const comp of wall.components) {
        const levelQty = distributeByScaffoldLevel(comp, wallLevels, scaffoldLevelCount);
        const floorQty = aggregateLevelQtyToFloors(levelQty, levelHeightMm, buildingFloorCount);
        matrixRows.push({
          wallIndex: wi,
          groupKey: `${comp.type}\t${comp.nameJp}\t${comp.unit}`,
          categoryDisplay: excelCategory(comp, locale),
          nameDisplay: excelMaterialName(comp, locale),
          bomSort: {
            type: comp.type,
            sortOrder: comp.sortOrder,
            sizeSpec: comp.sizeSpec || '',
          },
          spec: comp.sizeSpec || '-',
          unit: comp.unit || '-',
          floorQty,
          total: floorQty.reduce((s, n) => s + n, 0),
        });
      }
    }

    return { matrixRows, buildingFloorCount, levelHeightMm, scaffoldLevelCount };
  }

  private groupBreakdownWallRows(wallRows: BreakdownMatrixRow[]): BreakdownMatrixRow[][] {
    const sorted = [...wallRows].sort((a, b) => compareCalculatedComponentsForBom(a.bomSort, b.bomSort));
    const groups: BreakdownMatrixRow[][] = [];
    let lastKey = '';
    for (const r of sorted) {
      if (r.groupKey !== lastKey) {
        groups.push([]);
        lastKey = r.groupKey;
      }
      groups[groups.length - 1].push(r);
    }
    return groups;
  }

  private writePerEdgeFloorTables(
    sheet: ExcelJS.Worksheet,
    result: ScaffoldCalculationResult,
    ctx: {
      matrixRows: BreakdownMatrixRow[];
      buildingFloorCount: number;
      levelHeightMm: number;
      scaffoldLevelCount: number;
    },
    str: ScaffoldExcelStrings,
  ) {
    const walls = result.walls;
    const { matrixRows, buildingFloorCount } = ctx;
    const poly = (result as { polygonVertices?: unknown[] }).polygonVertices;
    const closedFootprint = Array.isArray(poly) && poly.length >= 3;
    const labeling = (result as { edgeHashiraLabeling?: EdgeHashiraLabeling }).edgeHashiraLabeling;
    const bannerMergeCols = 5 + buildingFloorCount + 1;
    const perEdgeColCount = 4 + buildingFloorCount;

    const floorLabels = Array.from({ length: buildingFloorCount }, (_, i) => str.floorN(i + 1));

    for (let wi = 0; wi < walls.length; wi++) {
      const wall = walls[wi];
      const chord = edgeChordNameExcel(wi, walls.length, closedFootprint);
      const xy = resolveEdgeHashiraXY(labeling, wi, walls.length, wall.sideJp ?? '', wall.side ?? '');
      const along =
        xy.alongRange ||
        (xy.alongStations.length > 0
          ? `${xy.alongStations[0]}–${xy.alongStations[xy.alongStations.length - 1]}`
          : '');
      const cross = xy.crossLabel || '';
      const wallLen = wall.wallLengthMm.toLocaleString();
      const line1 = str.edgeLine1(chord, wallLen, wall.totalSpans, wall.levelCalc?.fullLevels ?? 1);
      const line2 =
        cross || along
          ? str.edgeLine2(cross || str.empty, along || str.empty)
          : '';

      sheet.addRow([]);
      const banner = sheet.addRow([line1 + (line2 ? `\n${line2}` : '')]);
      banner.font = { bold: true, size: 11 };
      sheet.mergeCells(banner.number, 1, banner.number, bannerMergeCols);
      banner.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      banner.getCell(1).alignment = { vertical: 'middle', wrapText: true };
      banner.getCell(1).border = BORDER_THIN as ExcelJS.Borders;
      if (banner.height != null) banner.height = line2 ? 36 : 22;

      const hdr = sheet.addRow([str.colMaterialName, str.colSpec, str.colUnit, ...floorLabels, str.colTotal]);
      this.styleHeaderRowFull(hdr, 1, perEdgeColCount);
      hdr.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

      const wallGroups = this.groupBreakdownWallRows(matrixRows.filter((r) => r.wallIndex === wi));
      for (const g of wallGroups) {
        for (let i = 0; i < g.length; i++) {
          const row = g[i];
          const dr = sheet.addRow([row.nameDisplay, row.spec, row.unit, ...row.floorQty, row.total]);
          for (let c = 1; c <= perEdgeColCount; c++) {
            dr.getCell(c).border = BORDER_THIN as ExcelJS.Borders;
          }
          const lastC = perEdgeColCount;
          dr.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
          for (let c = 4; c <= lastC; c++) {
            dr.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
          }
          dr.getCell(lastC).font = { bold: true };
        }
      }

      const edgeFloorSums = Array.from({ length: buildingFloorCount }, (_, idx) =>
        matrixRows.filter((r) => r.wallIndex === wi).reduce((acc, r) => acc + (r.floorQty[idx] || 0), 0),
      );
      const edgeGrand = matrixRows.filter((r) => r.wallIndex === wi).reduce((s, r) => s + r.total, 0);
      const sub = sheet.addRow([str.subtotalEdge, '', '', ...edgeFloorSums, edgeGrand]);
      sub.font = { bold: true, size: 10 };
      for (let c = 1; c <= perEdgeColCount; c++) {
        sub.getCell(c).border = BORDER_THIN as ExcelJS.Borders;
        sub.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      }
      for (let c = 4; c <= perEdgeColCount; c++) {
        sub.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }
  }

  private buildExcelWallColumnHeaders(result: ScaffoldCalculationResult): string[] {
    const poly = (result as { polygonVertices?: unknown[] }).polygonVertices;
    const closedFootprint = Array.isArray(poly) && poly.length >= 3;
    const labeling = (result as { edgeHashiraLabeling?: EdgeHashiraLabeling }).edgeHashiraLabeling;
    return result.walls.map((_, wi) =>
      excelQuotationWallColumnHeader(wi, result.walls, closedFootprint, labeling),
    );
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

  private summarizeSpans(spans: number[], str: ScaffoldExcelStrings): string {
    const groups: Record<number, number> = {};
    for (const s of spans) {
      groups[s] = (groups[s] || 0) + 1;
    }
    return Object.entries(groups)
      .map(([size, count]) => `${size}mm×${count}${str.spanTimesSuffix}`)
      .join(str.spanJoiner);
  }
}
