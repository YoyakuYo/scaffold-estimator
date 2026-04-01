import type { CalculatedComponent } from './scaffold-calculator.service';

export type ExcelExportLocale = 'ja' | 'en' | 'fr';

export function normalizeExcelLocale(raw?: string): ExcelExportLocale {
  const s = (raw || 'ja').toLowerCase();
  if (s.startsWith('en')) return 'en';
  if (s.startsWith('fr')) return 'fr';
  return 'ja';
}

export interface ScaffoldExcelStrings {
  sheetName: string;
  docTitleKusabi: string;
  docTitleWakugumi: string;
  siteContactTitle: string;
  siteName: string;
  address: string;
  phone: string;
  email: string;
  fax: string;
  empty: string;
  specWidth: string;
  specLevels: string;
  specLevelHeight: string;
  specMaxHeight: string;
  specFrame: string;
  specHabakiPerSpan: string;
  specPost: string;
  specTop: string;
  specScaffoldTypeKusabi: string;
  specScaffoldTypeWakugumi: string;
  sectionSpans: string;
  colEdgeLabel: string;
  colSpanCount: string;
  colSpanDetail: string;
  colWallLengthMm: string;
  sectionOverall: string;
  sectionFloorAggregate: string;
  sectionEdgeFloor: string;
  colNo: string;
  colCategory: string;
  colName: string;
  colSpec: string;
  colUnit: string;
  colTotal: string;
  floorN: (n: number) => string;
  sumLabel: string;
  colMaterialName: string;
  spanTimesSuffix: string;
  spanJoiner: string;
  edgeLine1: (chord: string, wallLen: string, spans: number, levels: number) => string;
  edgeLine2: (cross: string, along: string) => string;
  subtotalEdge: string;
  sameAsAbove: string;
}

const STR: Record<ExcelExportLocale, ScaffoldExcelStrings> = {
  ja: {
    sheetName: '足場材料見積書',
    docTitleKusabi: 'くさび式足場 材料見積書',
    docTitleWakugumi: '枠組足場 材料見積書',
    siteContactTitle: '現場・連絡先',
    siteName: '現場名・件名',
    address: '住所',
    phone: '電話',
    email: 'メール',
    fax: 'FAX',
    empty: '—',
    specWidth: '足場幅',
    specLevels: '段数',
    specLevelHeight: '1段の高さ',
    specMaxHeight: '最大足場高',
    specFrame: '建枠',
    specHabakiPerSpan: '巾木',
    specPost: '支柱',
    specTop: '上部',
    specScaffoldTypeKusabi: 'くさび式足場',
    specScaffoldTypeWakugumi: '枠組足場',
    sectionSpans: '各辺スパン',
    colEdgeLabel: '辺（表示名）',
    colSpanCount: 'スパン数',
    colSpanDetail: 'スパン内訳',
    colWallLengthMm: '壁長 (mm)',
    sectionOverall: '1. 全体集計（全材料・合計数量）',
    sectionFloorAggregate: '2. 建物階別集計（全辺合算）',
    sectionEdgeFloor: '3. 辺別・階別内訳（通り X/Y・辺 AB）',
    colNo: 'No',
    colCategory: '分類',
    colName: '部材名',
    colSpec: '規格（SIZE）',
    colUnit: '単位',
    colTotal: '合計',
    floorN: (n) => `${n}階`,
    sumLabel: '合計',
    colMaterialName: '部材名',
    spanTimesSuffix: '本',
    spanJoiner: ' ＋ ',
    edgeLine1: (chord, wallLen, spans, levels) =>
      `辺 ${chord}  |  壁長 ${wallLen} mm  |  スパン ${spans}  |  足場段 ${levels}`,
    edgeLine2: (cross, along) => `通り: 交差 ${cross}  |  沿い ${along}`,
    subtotalEdge: '小計（当該辺）',
    sameAsAbove: '〃',
  },
  en: {
    sheetName: 'Scaffold quote',
    docTitleKusabi: 'Kusabi scaffold — material quote',
    docTitleWakugumi: 'Frame scaffold — material quote',
    siteContactTitle: 'Site & contact',
    siteName: 'Site / title',
    address: 'Address',
    phone: 'Phone',
    email: 'Email',
    fax: 'Fax',
    empty: '—',
    specWidth: 'Scaffold width',
    specLevels: 'Levels',
    specLevelHeight: 'Lift height',
    specMaxHeight: 'Max scaffold height',
    specFrame: 'Frame',
    specHabakiPerSpan: 'Toe boards / span',
    specPost: 'Main post',
    specTop: 'Top guard',
    specScaffoldTypeKusabi: 'Kusabi scaffold',
    specScaffoldTypeWakugumi: 'Frame scaffold',
    sectionSpans: 'Spans per edge',
    colEdgeLabel: 'Edge (label)',
    colSpanCount: 'Span count',
    colSpanDetail: 'Span breakdown',
    colWallLengthMm: 'Wall length (mm)',
    sectionOverall: '1. Overall totals (all materials)',
    sectionFloorAggregate: '2. By building floor (all edges)',
    sectionEdgeFloor: '3. By edge and floor (grid / chord)',
    colNo: 'No',
    colCategory: 'Category',
    colName: 'Component',
    colSpec: 'Spec (size)',
    colUnit: 'Unit',
    colTotal: 'Total',
    floorN: (n) => `Fl.${n}`,
    sumLabel: 'Total',
    colMaterialName: 'Component',
    spanTimesSuffix: 'ea',
    spanJoiner: ' + ',
    edgeLine1: (chord, wallLen, spans, levels) =>
      `Edge ${chord}  |  Wall length ${wallLen} mm  |  Spans ${spans}  |  Scaffold levels ${levels}`,
    edgeLine2: (cross, along) => `Grid: cross ${cross}  |  along ${along}`,
    subtotalEdge: 'Subtotal (this edge)',
    sameAsAbove: '〃',
  },
  fr: {
    sheetName: 'Devis échafaudage',
    docTitleKusabi: 'Échafaudage Kusabi — devis matériaux',
    docTitleWakugumi: 'Échafaudage à cadres — devis matériaux',
    siteContactTitle: 'Chantier & contacts',
    siteName: 'Chantier / objet',
    address: 'Adresse',
    phone: 'Tél.',
    email: 'E-mail',
    fax: 'Fax',
    empty: '—',
    specWidth: 'Largeur échafaudage',
    specLevels: 'Niveaux',
    specLevelHeight: 'Hauteur d’un niveau',
    specMaxHeight: 'Hauteur max. échafaudage',
    specFrame: 'Cadre',
    specHabakiPerSpan: 'Plinthes / travée',
    specPost: 'Montant',
    specTop: 'Garde-corps haut',
    specScaffoldTypeKusabi: 'Échafaudage Kusabi',
    specScaffoldTypeWakugumi: 'Échafaudage à cadres',
    sectionSpans: 'Travées par côté',
    colEdgeLabel: 'Côté (libellé)',
    colSpanCount: 'Nb. travées',
    colSpanDetail: 'Détail travées',
    colWallLengthMm: 'Longueur mur (mm)',
    sectionOverall: '1. Totaux généraux (tous matériaux)',
    sectionFloorAggregate: '2. Par étage du bâtiment (tous côtés)',
    sectionEdgeFloor: '3. Par côté et étage (grille / corde)',
    colNo: 'N°',
    colCategory: 'Catégorie',
    colName: 'Composant',
    colSpec: 'Spéc. (taille)',
    colUnit: 'Unité',
    colTotal: 'Total',
    floorN: (n) => `${n}e ét.`,
    sumLabel: 'Total',
    colMaterialName: 'Composant',
    spanTimesSuffix: '',
    spanJoiner: ' + ',
    edgeLine1: (chord, wallLen, spans, levels) =>
      `Côté ${chord}  |  Longueur ${wallLen} mm  |  Travées ${spans}  |  Niveaux ${levels}`,
    edgeLine2: (cross, along) => `Quadrillage : perpend. ${cross}  |  suivant ${along}`,
    subtotalEdge: 'Sous-total (ce côté)',
    sameAsAbove: 'idem',
  },
};

export function getScaffoldExcelStrings(loc: ExcelExportLocale): ScaffoldExcelStrings {
  return STR[loc];
}

export function excelMaterialName(c: CalculatedComponent, loc: ExcelExportLocale): string {
  if (loc === 'ja') return c.nameJp || c.name || c.type;
  return (c.name || c.nameJp || c.type).trim();
}

export function excelCategory(c: CalculatedComponent, loc: ExcelExportLocale): string {
  if (loc === 'ja') return c.category || '';
  return (c.categoryEn || c.category || '').trim();
}
