'use client';

import { Fragment, useMemo } from 'react';
import { Package } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { EdgeHashiraLabeling } from '@/lib/api/scaffold-configs';
import { EdgeHashiraResultPanel } from '@/components/edge-hashira-result-panel';
import { edgeChordName, resolveEdgeHashiraXY } from '@/lib/edge-hashira-labels';
import { compareCalculatedComponentsForBom } from '@/lib/scaffold-bom-sort';

type MatrixRow = {
  key: string;
  wallIndex: number;
  material: string;
  spec: string;
  unit: string;
  floorQty: number[];
  total: number;
  groupKey: string;
  bomSort: { type: string; sortOrder: number; sizeSpec: string };
};

/** Same material (type + JP name + unit): one 部材 cell with rowSpan, one row per 規格. */
function groupBreakdownMaterialRows(wallRows: MatrixRow[]): Array<{ material: string; rows: MatrixRow[] }> {
  const sorted = [...wallRows].sort((a, b) =>
    compareCalculatedComponentsForBom(a.bomSort, b.bomSort),
  );
  const groups: MatrixRow[][] = [];
  let lastKey = '';
  for (const r of sorted) {
    if (r.groupKey !== lastKey) {
      groups.push([]);
      lastKey = r.groupKey;
    }
    groups[groups.length - 1].push(r);
  }
  return groups.map((rows) => ({
    material: rows[0].material,
    rows,
  }));
}

interface CalculatedComponent {
  type: string;
  category: string;
  categoryEn: string;
  name: string;
  nameJp: string;
  sizeSpec: string;
  unit: string;
  quantity: number;
  sortOrder: number;
  materialCode?: string;
}

interface WallResult {
  side: string;
  sideJp: string;
  wallLengthMm: number;
  wallHeightMm: number;
  totalSpans: number;
  stairAccessCount?: number;
  levelCalc: { fullLevels: number; totalHeight: number };
  components: CalculatedComponent[];
}

/** Typical story height (mm) for estimating building floor count from total height — not scaffold lift height. */
const TYPICAL_BUILDING_STORY_MM = 3000;

/** Map per–scaffold-lift quantities into estimated building-floor bands (~3 m). */
function aggregateLevelQtyToFloors(
  levelQty: number[],
  levelHeightMm: number,
  buildingFloorCount: number,
): number[] {
  const floors = Array.from({ length: buildingFloorCount }, () => 0);
  for (let l = 0; l < levelQty.length; l++) {
    const qty = levelQty[l] || 0;
    if (qty === 0) continue;
    const yMid = (l + 0.5) * levelHeightMm;
    const f = Math.min(
      buildingFloorCount - 1,
      Math.max(0, Math.floor(yMid / TYPICAL_BUILDING_STORY_MM)),
    );
    floors[f] += qty;
  }
  return floors;
}

interface Props {
  walls: WallResult[];
  buildingHeightMm: number;
  scaffoldWidthMm: number;
  totalLevels: number;
  levelHeightMm?: number;
  edgeHashiraLabeling?: EdgeHashiraLabeling | null;
  /** For closed chord naming (polygon in calculation result). */
  polygonVertexCount?: number;
}

export function MaterialBreakdownTable({
  walls,
  buildingHeightMm,
  scaffoldWidthMm,
  totalLevels,
  levelHeightMm = 1800,
  edgeHashiraLabeling,
  polygonVertexCount = 0,
}: Props) {
  const { t, locale } = useI18n();

  /** Scaffold lift tiers (段) — column count and quantity distribution. */
  const scaffoldLevelCount = useMemo(() => {
    return Math.max(1, totalLevels || Math.ceil(buildingHeightMm / levelHeightMm));
  }, [buildingHeightMm, levelHeightMm, totalLevels]);

  /** Building stories (階) — estimated from overall height; not the same as scaffold levels. */
  const buildingFloorCount = useMemo(() => {
    return Math.max(1, Math.ceil(buildingHeightMm / TYPICAL_BUILDING_STORY_MM));
  }, [buildingHeightMm]);

  /** Table columns: building floors (estimate), not scaffold lifts. */
  const floorColumnLabels = useMemo(
    () =>
      Array.from({ length: buildingFloorCount }, (_, i) => {
        const n = i + 1;
        if (locale === 'ja') return `${n}階`;
        if (locale === 'fr') return `Ét.${n}`;
        return `F${n}`;
      }),
    [buildingFloorCount, locale],
  );

  const translateMaterialName = (comp: CalculatedComponent) => {
    if (locale === 'ja') return comp.nameJp;
    if (locale === 'fr') {
      const map: Record<string, string> = {
        jack_base: 'Base de vérin',
        post_main: 'Poteau principal',
        post_top: 'Poteau de garde supérieur',
        brace: 'Contreventement',
        nuno_bar: 'Lisse / Main courante',
        anchi: 'Plancher',
        anchi_half: 'Demi-plancher',
        habaki: 'Plinthe',
        stair_set: 'Escalier',
        frame: 'Cadre',
        shitasan: 'Barre inférieure',
        stopper_nuno: "Arrêt d'extrémité (lisse)",
        stopper_frame: "Arrêt d'extrémité (cadre)",
      };
      return map[comp.type] || comp.name || comp.nameJp;
    }
    return comp.name || comp.nameJp;
  };

  const distributeByScaffoldLevel = (comp: CalculatedComponent, wallLevels: number): number[] => {
    const rows = Array.from({ length: scaffoldLevelCount }, () => 0);
    const levels = Math.max(1, wallLevels);
    const qty = Math.max(0, Math.round(comp.quantity || 0));
    if (qty <= 0) return rows;

    // Jack base: lowest scaffold lift only.
    if (comp.type === 'jack_base') {
      rows[0] = qty;
      return rows;
    }

    // Top guard posts at top active scaffold level.
    if (comp.type === 'post_top') {
      rows[Math.min(levels - 1, scaffoldLevelCount - 1)] = qty;
      return rows;
    }

    const visibleLevels = Math.min(levels, scaffoldLevelCount);
    const baseQty = Math.floor(qty / levels);
    let rem = qty - baseQty * levels;
    for (let i = 0; i < visibleLevels; i++) {
      rows[i] = baseQty + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
    }
    if (levels > scaffoldLevelCount) {
      rows[scaffoldLevelCount - 1] += baseQty * (levels - scaffoldLevelCount);
      if (rem > 0) rows[scaffoldLevelCount - 1] += rem;
    }
    return rows;
  };

  const xyByWall = useMemo(
    () =>
      walls.map((w, wi) =>
        resolveEdgeHashiraXY(edgeHashiraLabeling, wi, walls.length, w.sideJp, w.side),
      ),
    [walls, edgeHashiraLabeling],
  );

  const matrixRows = useMemo(() => {
    const rows: MatrixRow[] = [];

    for (let wi = 0; wi < walls.length; wi++) {
      const wall = walls[wi];
      const wallLevels = wall.levelCalc?.fullLevels || 1;
      for (const comp of wall.components) {
        const levelQty = distributeByScaffoldLevel(comp, wallLevels);
        const floorQty = aggregateLevelQtyToFloors(levelQty, levelHeightMm, buildingFloorCount);
        const groupKey = `${comp.type}\t${comp.nameJp}\t${comp.unit}`;
        rows.push({
          key: `${wi}::${wall.side}::${comp.type}::${comp.sizeSpec}`,
          wallIndex: wi,
          material: translateMaterialName(comp),
          spec: comp.sizeSpec || '-',
          unit: comp.unit || '-',
          floorQty,
          total: floorQty.reduce((sum, n) => sum + n, 0),
          groupKey,
          bomSort: {
            type: comp.type,
            sortOrder: comp.sortOrder,
            sizeSpec: comp.sizeSpec || '',
          },
        });
      }
    }
    return rows;
  }, [walls, scaffoldLevelCount, buildingFloorCount, levelHeightMm, locale]);

  const tableColSpan = 5 + floorColumnLabels.length + 1;

  const breakdownSections = useMemo(() => {
    const closedFootprint = polygonVertexCount >= 3;
    return walls.map((wall, wi) => {
      const wallRows = matrixRows.filter((r) => r.wallIndex === wi);
      return {
        key: `sec-${wi}-${edgeChordName(wi, walls.length, closedFootprint)}`,
        chord: edgeChordName(wi, walls.length, closedFootprint),
        lengthMm: wall.wallLengthMm,
        wallHeightMm: wall.wallHeightMm,
        totalSpans: wall.totalSpans,
        fullLevels: wall.levelCalc?.fullLevels ?? 1,
        stairAccessCount: wall.stairAccessCount ?? 0,
        xy: xyByWall[wi],
        rows: wallRows,
        materialGroups: groupBreakdownMaterialRows(wallRows),
      };
    });
  }, [walls, matrixRows, polygonVertexCount, xyByWall]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Package className="h-5 w-5" />
          {t('result', 'materialBreakdownTitle')}
        </h3>
      </div>

      <div className="bg-blue-50 px-6 py-2 border-b border-blue-100 flex items-center gap-6 text-xs text-blue-700">
        <span>{t('result', 'buildingHeight')}: {(buildingHeightMm / 1000).toFixed(1)}m</span>
        <span>{t('result', 'scaffoldWidth')}: {scaffoldWidthMm}mm</span>
        <span>{t('result', 'levels')}: {totalLevels}</span>
        <span>{t('result', 'floors')}: {buildingFloorCount}</span>
        <span>{t('result', 'walls')}: {walls.length}</span>
      </div>

      <EdgeHashiraResultPanel
        labeling={edgeHashiraLabeling}
        walls={walls}
        closedFootprint={polygonVertexCount >= 3}
        className="mx-6 mt-3 mb-2"
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-200">
              <th className="text-left py-3 px-4 font-semibold text-gray-700 min-w-[90px]">
                {t('result', 'colLine')}
              </th>
              <th className="text-left py-3 px-4 font-semibold text-gray-700 min-w-[110px]">
                {t('result', 'colRun')}
              </th>
              <th className="text-left py-3 px-4 font-semibold text-gray-700 min-w-[180px]">
                {t('result', 'colName')}
              </th>
              <th className="text-left py-3 px-3 font-semibold text-gray-700 min-w-[120px]">
                {t('result', 'colSpec')}
              </th>
              <th className="text-center py-3 px-3 font-semibold text-gray-700 min-w-[70px]">
                {t('result', 'colUnit')}
              </th>
              {floorColumnLabels.map((label) => (
                <th key={label} className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[70px]">
                  {label}
                </th>
              ))}
              <th className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[80px]">
                {t('result', 'colTotal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdownSections.map((sec) => (
              <Fragment key={sec.key}>
                <tr className="bg-slate-200/95 border-t border-slate-300">
                  <td colSpan={tableColSpan} className="py-2 px-4">
                    <div className="text-sm font-bold text-slate-900 tracking-wide">
                      {locale === 'ja' && '辺 '}
                      {locale === 'fr' && 'Arête '}
                      {locale === 'en' && 'Edge '}
                      <span className="font-mono">{sec.chord}</span>
                      {' — '}
                      {sec.lengthMm.toLocaleString()} mm
                    </div>
                    <div className="mt-1 text-xs font-normal text-slate-600">
                      {t('resultExtra', 'spans')}: {sec.totalSpans}
                      {' · '}
                      {t('result', 'levels')}: {sec.fullLevels}
                      {' · '}
                      {t('result', 'wallHeight')}: {sec.wallHeightMm.toLocaleString()} mm
                      {' · '}
                      {t('resultExtra', 'stairs')}: {sec.stairAccessCount}
                      {t('resultExtra', 'stairsUnit')}
                    </div>
                  </td>
                </tr>
                {(() => {
                  const alongOneLiner =
                    sec.xy.alongRange ||
                    (sec.xy.alongStations.length > 0
                      ? `${sec.xy.alongStations[0]}–${sec.xy.alongStations[sec.xy.alongStations.length - 1]}`
                      : '');
                  const showHashiraRow = !!(sec.xy.crossLabel || alongOneLiner);
                  if (!showHashiraRow) return null;
                  return (
                    <tr className="bg-slate-100/95 border-b border-slate-200">
                      <td className="py-2 px-4 align-middle border-r border-slate-200/80">
                        <span className="text-[10px] text-slate-500 font-medium block mb-0.5">
                          {t('result', 'hashiraCross')}
                        </span>
                        <span className="font-mono text-sm font-semibold text-slate-900">
                          {sec.xy.crossLabel ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 px-4 align-middle border-r border-slate-200/80">
                        <span className="text-[10px] text-slate-500 font-medium block mb-0.5">
                          {t('result', 'hashiraAlong')}
                        </span>
                        <span className="font-mono text-sm font-semibold text-slate-900">{alongOneLiner || '—'}</span>
                      </td>
                      <td colSpan={tableColSpan - 2} className="py-1 bg-slate-50/50" aria-hidden />
                    </tr>
                  );
                })()}
                {sec.materialGroups.map((grp) => (
                  <Fragment key={`mg-${grp.rows[0]?.key ?? ''}`}>
                    {grp.rows.map((row, ri) => {
                    const rs = grp.rows.length;
                    return (
                      <tr key={row.key} className="border-b border-gray-100 hover:bg-gray-50">
                        {ri === 0 ? (
                          <>
                            <td
                              className="py-2.5 px-4 bg-white align-top border-r border-gray-100"
                              rowSpan={rs}
                            />
                            <td
                              className="py-2.5 px-4 bg-white align-top border-r border-gray-100"
                              rowSpan={rs}
                            />
                            <td
                              className="py-2.5 px-4 font-medium text-gray-800 align-top bg-white border-r border-gray-100"
                              rowSpan={rs}
                            >
                              {grp.material}
                            </td>
                          </>
                        ) : null}
                        <td className="py-2.5 px-3 text-gray-700">{row.spec}</td>
                        <td className="py-2.5 px-3 text-center text-gray-700">{row.unit}</td>
                        {row.floorQty.map((qty, idx) => (
                          <td key={`${row.key}-fl${idx}`} className="py-2.5 px-3 text-right font-mono text-gray-700">
                            {qty.toLocaleString()}
                          </td>
                        ))}
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                          {row.total.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300">
              <td className="py-3 px-4 font-bold text-gray-800" colSpan={5}>
                {t('result', 'colTotal')}
              </td>
              {floorColumnLabels.map((_, idx) => {
                const sum = matrixRows.reduce((acc, row) => acc + (row.floorQty[idx] || 0), 0);
                return (
                  <td key={`sum-fl-${idx}`} className="py-3 px-3 text-right font-mono font-semibold text-gray-800">
                    {sum.toLocaleString()}
                  </td>
                );
              })}
              <td className="py-3 px-3 text-right font-mono font-bold text-gray-900">
                {matrixRows.reduce((sum, row) => sum + row.total, 0).toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-6 py-2 text-xs text-gray-500 border-t border-gray-100 bg-gray-50 space-y-1">
        <p>{t('result', 'jackBaseGroundOnlyNote')}</p>
        <p>{t('result', 'materialBreakdownFloorColsNote')}</p>
      </div>
    </div>
  );
}
