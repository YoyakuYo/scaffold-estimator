import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { ConstructionPlanProject } from '../construction-plan-project.entity';
import type { DrawingSet } from '../drawing-set.entity';
import type { ExtractedElement } from '../extracted-element.entity';
import type { StructuralElementType } from '../element-types';
import { STRUCTURAL_ELEMENT_TYPES } from '../element-types';
import type { ScheduleActivity } from './erection-sequencer';
import { runSequencer } from './erection-sequencer';
import { buildDeliveryPlan, type DeliveryPlanResult } from './delivery-plan';
import { DEFAULT_DURATION_TEMPLATE, type DurationTemplate } from './duration-template';
import { DEFAULT_TRUCKS } from './truck-bin-pack';
import { todayIso } from './calendar';

const ELEMENT_LABEL_JP: Record<StructuralElementType, string> = {
  hashira: '柱',
  oobari: '大梁',
  kobari: '小梁',
  taifubari: '耐風梁',
  brace: 'ブレース',
  kaidan: '階段',
  elevator: 'エレベーター',
  deck: 'デッキ',
};

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  bottom: { style: 'thin' },
  left: { style: 'thin' },
  right: { style: 'thin' },
};

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE5E7EB' },
};

const ACTIVITY_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFBFDBFE' },
};

@Injectable()
export class ConstructionPlanExcelService {
  /**
   * Build the 8-sheet Excel workbook for a Construction Plan set:
   *   1. 工程表 (master Gantt by activity x date)
   *   2. 数量集計 (element type x level x block totals)
   *   3. 月次集計
   *   4. 週次集計
   *   5. 日次集計
   *   6. 搬入計画 (one row per truck)
   *   7. トラック日報 (one printable card block per work day)
   *   8. 凡例・条件 (legend / assumptions: durations, trucks, holidays)
   */
  async build(
    project: ConstructionPlanProject,
    set: DrawingSet,
    elements: ExtractedElement[],
    options?: {
      template?: DurationTemplate;
      startDateIso?: string;
      workSaturday?: boolean;
    },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const tmpl = options?.template ?? DEFAULT_DURATION_TEMPLATE;
    const startDateIso = options?.startDateIso ?? todayIso();
    const sequencer = runSequencer({
      levels: project.levels.length > 0 ? project.levels : ['1F'],
      blocks: project.blocks ?? [],
      elements,
      template: tmpl,
      calendar: { startDateIso, workSaturday: options?.workSaturday ?? true },
    });
    const delivery = buildDeliveryPlan(sequencer.activities, sequencer.dailyDemand);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Zoomen Reader';
    wb.created = new Date();

    this.writeMasterGantt(wb, project, set, sequencer.activities, sequencer.workingDays);
    this.writeQuantitySummary(wb, project, elements);
    this.writeMonthlySummary(wb, delivery);
    this.writeWeeklySummary(wb, delivery);
    this.writeDailySummary(wb, delivery);
    this.writeDeliveryPlan(wb, delivery);
    this.writeDailyTruckCards(wb, delivery);
    this.writeLegend(wb, project, tmpl, startDateIso, options?.workSaturday ?? true);

    const arr = await wb.xlsx.writeBuffer();
    const filename = `construction_plan_${set.id.slice(0, 8)}.xlsx`;
    return { buffer: Buffer.from(arr as ArrayBuffer), filename };
  }

  // ─── 1. 工程表 ─────────────────────────────────────────────

  private writeMasterGantt(
    wb: ExcelJS.Workbook,
    project: ConstructionPlanProject,
    set: DrawingSet,
    activities: ScheduleActivity[],
    workingDays: string[],
  ): void {
    const sheet = wb.addWorksheet('工程表', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.getCell('A1').value = `工程表 - ${project.name}`;
    sheet.getCell('A1').font = { bold: true, size: 14 };
    sheet.getCell('A2').value = `Set: ${set.name || set.id.slice(0, 8)}`;
    sheet.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };

    const headerRow = 4;
    sheet.getCell(headerRow, 1).value = '工区';
    sheet.getCell(headerRow, 2).value = '階';
    sheet.getCell(headerRow, 3).value = '部材';
    for (let i = 0; i < workingDays.length; i++) {
      const dateIso = workingDays[i];
      const col = 4 + i;
      const cell = sheet.getCell(headerRow, col);
      cell.value = dateIso.slice(5);
      cell.font = { size: 9 };
      cell.alignment = { horizontal: 'center', textRotation: 90 };
      cell.fill = HEADER_FILL;
      cell.border = THIN;
    }
    for (let c = 1; c <= 3; c++) {
      const cell = sheet.getCell(headerRow, c);
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.border = THIN;
    }
    sheet.getColumn(1).width = 8;
    sheet.getColumn(2).width = 8;
    sheet.getColumn(3).width = 10;
    for (let i = 0; i < workingDays.length; i++) sheet.getColumn(4 + i).width = 4;

    const dateIndex = new Map<string, number>();
    workingDays.forEach((d, i) => dateIndex.set(d, 4 + i));

    let r = headerRow + 1;
    for (const a of activities) {
      sheet.getCell(r, 1).value = a.block ?? '—';
      sheet.getCell(r, 2).value = a.level;
      sheet.getCell(r, 3).value = ELEMENT_LABEL_JP[a.elementType] ?? a.elementType;
      for (let c = 1; c <= 3; c++) sheet.getCell(r, c).border = THIN;
      const startCol = dateIndex.get(a.startIso);
      const endCol = dateIndex.get(a.endIso);
      if (startCol != null && endCol != null) {
        for (let c = startCol; c <= endCol; c++) {
          const cell = sheet.getCell(r, c);
          cell.fill = ACTIVITY_FILL;
          cell.border = THIN;
        }
        if (endCol > startCol) {
          sheet.mergeCells(r, startCol, r, endCol);
        }
        const labelCell = sheet.getCell(r, startCol);
        labelCell.value = `${a.totalPieces}本`;
        labelCell.font = { size: 9, bold: true };
        labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      r++;
    }
  }

  // ─── 2. 数量集計 ────────────────────────────────────────────

  private writeQuantitySummary(
    wb: ExcelJS.Workbook,
    project: ConstructionPlanProject,
    elements: ExtractedElement[],
  ): void {
    const sheet = wb.addWorksheet('数量集計');
    sheet.getRow(1).values = ['階', '工区', '部材', '符号', '断面', '数量', '通り芯', '出所', '備考'];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = HEADER_FILL;
    sheet.getRow(1).eachCell((c) => (c.border = THIN));
    [10, 8, 12, 10, 22, 8, 14, 10, 24].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

    const sortedElements = elements
      .slice()
      .sort((a, b) => {
        const lvCmp = a.level.localeCompare(b.level);
        if (lvCmp !== 0) return lvCmp;
        const blkCmp = (a.block ?? '').localeCompare(b.block ?? '');
        if (blkCmp !== 0) return blkCmp;
        return a.elementType.localeCompare(b.elementType);
      });

    let r = 2;
    for (const el of sortedElements) {
      sheet.getCell(r, 1).value = el.level;
      sheet.getCell(r, 2).value = el.block ?? '—';
      sheet.getCell(r, 3).value = ELEMENT_LABEL_JP[el.elementType] ?? el.elementType;
      sheet.getCell(r, 4).value = el.label ?? '';
      sheet.getCell(r, 5).value = el.section ?? '';
      sheet.getCell(r, 6).value = el.qty;
      sheet.getCell(r, 7).value = el.grid ?? '';
      sheet.getCell(r, 8).value = el.source;
      sheet.getCell(r, 9).value = el.notes ?? '';
      for (let c = 1; c <= 9; c++) sheet.getCell(r, c).border = THIN;
      r++;
    }
    if (r > 2) {
      sheet.getCell(r, 5).value = '合計';
      sheet.getCell(r, 5).font = { bold: true };
      sheet.getCell(r, 6).value = { formula: `SUM(F2:F${r - 1})` };
      sheet.getCell(r, 6).font = { bold: true };
    }
    sheet.getCell(`A${r + 2}`).value = `案件: ${project.name}`;
    sheet.getCell(`A${r + 2}`).font = { italic: true };
  }

  // ─── 3-5 aggregates ────────────────────────────────────────

  private writeMonthlySummary(wb: ExcelJS.Workbook, plan: DeliveryPlanResult): void {
    const sheet = wb.addWorksheet('月次集計');
    sheet.getRow(1).values = ['月', '稼働日数', '本数合計', '重量(t)', 'トラック便'];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = HEADER_FILL;
    sheet.getRow(1).eachCell((c) => (c.border = THIN));
    [12, 12, 12, 12, 12].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
    let r = 2;
    for (const m of plan.monthly) {
      sheet.getCell(r, 1).value = m.month;
      sheet.getCell(r, 2).value = m.days;
      sheet.getCell(r, 3).value = m.pieces;
      sheet.getCell(r, 4).value = Math.round(m.kg / 100) / 10; // tonnes 1 dp
      sheet.getCell(r, 5).value = m.trucks;
      for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = THIN;
      r++;
    }
  }

  private writeWeeklySummary(wb: ExcelJS.Workbook, plan: DeliveryPlanResult): void {
    const sheet = wb.addWorksheet('週次集計');
    sheet.getRow(1).values = ['週', '稼働日数', '本数合計', '重量(t)', 'トラック便'];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = HEADER_FILL;
    sheet.getRow(1).eachCell((c) => (c.border = THIN));
    [14, 12, 12, 12, 12].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
    let r = 2;
    for (const w of plan.weekly) {
      sheet.getCell(r, 1).value = w.isoWeek;
      sheet.getCell(r, 2).value = w.days;
      sheet.getCell(r, 3).value = w.pieces;
      sheet.getCell(r, 4).value = Math.round(w.kg / 100) / 10;
      sheet.getCell(r, 5).value = w.trucks;
      for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = THIN;
      r++;
    }
  }

  private writeDailySummary(wb: ExcelJS.Workbook, plan: DeliveryPlanResult): void {
    const sheet = wb.addWorksheet('日次集計');
    sheet.getRow(1).values = ['日付', '曜日', '本数', '重量(t)', 'トラック便'];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = HEADER_FILL;
    sheet.getRow(1).eachCell((c) => (c.border = THIN));
    [14, 6, 10, 10, 12].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
    let r = 2;
    for (const d of plan.days) {
      sheet.getCell(r, 1).value = d.date;
      sheet.getCell(r, 2).value = DOW_JP[(d.dow % 7 + 7) % 7];
      sheet.getCell(r, 3).value = d.totalPieces;
      sheet.getCell(r, 4).value = Math.round(d.totalKg / 100) / 10;
      sheet.getCell(r, 5).value = d.trucks.length;
      for (let c = 1; c <= 5; c++) sheet.getCell(r, c).border = THIN;
      r++;
    }
  }

  // ─── 6. 搬入計画 ───────────────────────────────────────────

  private writeDeliveryPlan(wb: ExcelJS.Workbook, plan: DeliveryPlanResult): void {
    const sheet = wb.addWorksheet('搬入計画');
    sheet.getRow(1).values = ['日付', '曜日', '便No', '車種', '工区', '階', '主品目', '内訳', '本数', '重量(t)', '最長(m)', '備考'];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = HEADER_FILL;
    sheet.getRow(1).eachCell((c) => (c.border = THIN));
    [12, 6, 6, 14, 6, 6, 14, 28, 8, 10, 10, 18].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
    let r = 2;
    for (const t of plan.trucks) {
      const head = t.load.items[0];
      sheet.getCell(r, 1).value = t.date;
      sheet.getCell(r, 2).value = DOW_JP[(t.dow % 7 + 7) % 7];
      sheet.getCell(r, 3).value = t.binNo;
      sheet.getCell(r, 4).value = t.load.truckLabel;
      sheet.getCell(r, 5).value = head?.block ?? '—';
      sheet.getCell(r, 6).value = head?.level ?? '—';
      sheet.getCell(r, 7).value = head ? ELEMENT_LABEL_JP[head.elementType] : '';
      sheet.getCell(r, 8).value = t.load.items
        .map((i) => `${ELEMENT_LABEL_JP[i.elementType]}×${i.pieces}`)
        .join(' / ');
      sheet.getCell(r, 9).value = t.load.items.reduce((s, i) => s + i.pieces, 0);
      sheet.getCell(r, 10).value = Math.round(t.load.totalKg / 100) / 10;
      sheet.getCell(r, 11).value = Math.round(t.load.totalLengthMm / 100) / 10;
      sheet.getCell(r, 12).value = t.load.notes.join(', ');
      for (let c = 1; c <= 12; c++) sheet.getCell(r, c).border = THIN;
      r++;
    }
  }

  // ─── 7. トラック日報 ───────────────────────────────────────

  private writeDailyTruckCards(wb: ExcelJS.Workbook, plan: DeliveryPlanResult): void {
    const sheet = wb.addWorksheet('トラック日報', {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    [16, 14, 12, 14, 12, 12].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

    let r = 1;
    for (const day of plan.days) {
      sheet.getCell(r, 1).value = `${day.date} (${DOW_JP[(day.dow % 7 + 7) % 7]})`;
      sheet.getCell(r, 1).font = { bold: true, size: 13 };
      sheet.mergeCells(r, 1, r, 6);
      r++;
      sheet.getCell(r, 1).value = `合計: ${day.trucks.length} 台 / ${day.totalPieces} 本 / ${(Math.round(day.totalKg / 100) / 10).toFixed(1)} t`;
      sheet.getCell(r, 1).font = { italic: true, color: { argb: 'FF6B7280' } };
      sheet.mergeCells(r, 1, r, 6);
      r += 1;

      sheet.getRow(r).values = ['便No', '車種', '工区', '階', '本数', '重量(t)'];
      sheet.getRow(r).font = { bold: true };
      sheet.getRow(r).fill = HEADER_FILL;
      sheet.getRow(r).eachCell((c) => (c.border = THIN));
      r++;
      let no = 1;
      for (const t of day.trucks) {
        const head = t.items[0];
        sheet.getCell(r, 1).value = no++;
        sheet.getCell(r, 2).value = t.truckLabel;
        sheet.getCell(r, 3).value = head?.block ?? '—';
        sheet.getCell(r, 4).value = head?.level ?? '—';
        sheet.getCell(r, 5).value = t.items.reduce((s, i) => s + i.pieces, 0);
        sheet.getCell(r, 6).value = Math.round(t.totalKg / 100) / 10;
        for (let c = 1; c <= 6; c++) sheet.getCell(r, c).border = THIN;
        r++;
      }
      r += 1; // gap between days
    }
  }

  // ─── 8. 凡例・条件 ────────────────────────────────────────

  private writeLegend(
    wb: ExcelJS.Workbook,
    project: ConstructionPlanProject,
    tmpl: DurationTemplate,
    startDateIso: string,
    workSaturday: boolean,
  ): void {
    const sheet = wb.addWorksheet('凡例・条件');
    [22, 18].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

    let r = 1;
    const set = (label: string, value: string | number) => {
      sheet.getCell(r, 1).value = label;
      sheet.getCell(r, 1).font = { bold: true };
      sheet.getCell(r, 2).value = value;
      r++;
    };

    sheet.getCell(r, 1).value = '計画条件';
    sheet.getCell(r, 1).font = { bold: true, size: 13 };
    r += 1;
    set('案件', project.name);
    set('開始日', startDateIso);
    set('土曜稼働', workSaturday ? '有' : '無');
    set('スラブ養生(working days)', tmpl.slabCureDays);
    set('工区ラグ(階)', tmpl.blockOverlapFloors);
    r += 1;

    sheet.getCell(r, 1).value = '部材日産レート (本/日)';
    sheet.getCell(r, 1).font = { bold: true, size: 12 };
    r++;
    for (const t of STRUCTURAL_ELEMENT_TYPES) {
      set(ELEMENT_LABEL_JP[t], tmpl.piecesPerDay[t] ?? '—');
    }
    r += 1;

    sheet.getCell(r, 1).value = 'トラック規格';
    sheet.getCell(r, 1).font = { bold: true, size: 12 };
    r++;
    sheet.getRow(r).values = ['車種', '最大積載(kg)', '荷台長(mm)', '長尺対応'];
    sheet.getRow(r).font = { bold: true };
    sheet.getRow(r).fill = HEADER_FILL;
    sheet.getRow(r).eachCell((c) => (c.border = THIN));
    r++;
    for (const truck of DEFAULT_TRUCKS) {
      sheet.getCell(r, 1).value = truck.label;
      sheet.getCell(r, 2).value = truck.payloadKg;
      sheet.getCell(r, 3).value = truck.bedLengthMm;
      sheet.getCell(r, 4).value = truck.acceptsLongPieces ? '有 (>12m, 道路使用許可)' : '無';
      for (let c = 1; c <= 4; c++) sheet.getCell(r, c).border = THIN;
      r++;
    }
  }
}
