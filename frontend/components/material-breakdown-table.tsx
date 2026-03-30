'use client';

import { Fragment, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { EdgeHashiraLabeling } from '@/lib/api/scaffold-configs';
import { EdgeHashiraResultPanel } from '@/components/edge-hashira-result-panel';
import { edgeChordName, resolveEdgeHashiraXY } from '@/lib/edge-hashira-labels';

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
  levelCalc: { fullLevels: number; totalHeight: number };
  components: CalculatedComponent[];
}

/** Typical story height (mm) for estimating building floor count from total height — not scaffold lift height. */
const TYPICAL_BUILDING_STORY_MM = 3000;

interface Props {
  walls: WallResult[];
  summary: CalculatedComponent[];
  buildingHeightMm: number;
  scaffoldWidthMm: number;
  totalLevels: number;
  levelHeightMm?: number;
  onPriceChange?: (materialCode: string, price: number) => void;
  prices?: Record<string, number>;
  edgeHashiraLabeling?: EdgeHashiraLabeling | null;
  /** For closed chord naming (polygon in calculation result). */
  polygonVertexCount?: number;
}

export function MaterialBreakdownTable({
  walls,
  summary,
  buildingHeightMm,
  scaffoldWidthMm,
  totalLevels,
  levelHeightMm = 1800,
  onPriceChange,
  prices = {},
  edgeHashiraLabeling,
  polygonVertexCount = 0,
}: Props) {
  const { t, locale } = useI18n();
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');

  /** Scaffold lift tiers (段) — column count and quantity distribution. */
  const scaffoldLevelCount = useMemo(() => {
    return Math.max(1, totalLevels || Math.ceil(buildingHeightMm / levelHeightMm));
  }, [buildingHeightMm, levelHeightMm, totalLevels]);

  /** Building stories (階) — estimated from overall height; not the same as scaffold levels. */
  const buildingFloorCount = useMemo(() => {
    return Math.max(1, Math.ceil(buildingHeightMm / TYPICAL_BUILDING_STORY_MM));
  }, [buildingHeightMm]);

  const scaffoldLevelLabels = useMemo(
    () =>
      Array.from({ length: scaffoldLevelCount }, (_, i) => {
        const n = i + 1;
        if (locale === 'ja') return `${n}段`;
        if (locale === 'fr') return `Niv.${n}`;
        return `Lv${n}`;
      }),
    [scaffoldLevelCount, locale],
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
    const rows: Array<{
      key: string;
      wallIndex: number;
      material: string;
      spec: string;
      unit: string;
      levelQty: number[];
      total: number;
      code: string;
    }> = [];

    for (let wi = 0; wi < walls.length; wi++) {
      const wall = walls[wi];
      const wallLevels = wall.levelCalc?.fullLevels || 1;
      for (const comp of wall.components) {
        const levelQty = distributeByScaffoldLevel(comp, wallLevels);
        rows.push({
          key: `${wi}::${wall.side}::${comp.type}::${comp.sizeSpec}`,
          wallIndex: wi,
          material: translateMaterialName(comp),
          spec: comp.sizeSpec || '-',
          unit: comp.unit || '-',
          levelQty,
          total: levelQty.reduce((sum, n) => sum + n, 0),
          code: comp.materialCode || comp.type,
        });
      }
    }
    return rows;
  }, [walls, scaffoldLevelCount, locale, xyByWall]);

  const tableColSpan = 5 + scaffoldLevelLabels.length + 3;

  const breakdownSections = useMemo(() => {
    const closedFootprint = polygonVertexCount >= 3;
    return walls.map((wall, wi) => ({
      key: `sec-${wi}-${edgeChordName(wi, walls.length, closedFootprint)}`,
      chord: edgeChordName(wi, walls.length, closedFootprint),
      lengthMm: wall.wallLengthMm,
      xy: xyByWall[wi],
      rows: matrixRows.filter((r) => r.wallIndex === wi),
    }));
  }, [walls, matrixRows, polygonVertexCount, xyByWall]);

  const handlePriceSubmit = (code: string) => {
    const val = parseFloat(priceValue);
    if (!isNaN(val) && val >= 0 && onPriceChange) {
      onPriceChange(code, val);
    }
    setEditingPrice(null);
  };

  const totalCost = useMemo(() => {
    return summary.reduce((acc, comp) => {
      const code = comp.materialCode || comp.type;
      const price = prices[code] || 0;
      return acc + comp.quantity * price;
    }, 0);
  }, [summary, prices]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Package className="h-5 w-5" />
          {t('result', 'materialBreakdownTitle')}
        </h3>
        {totalCost > 0 && (
          <span className="text-white/90 text-sm font-mono">
            {t('result', 'colTotal')}: ¥{totalCost.toLocaleString()}
          </span>
        )}
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
              {scaffoldLevelLabels.map((label) => (
                <th key={label} className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[70px]">
                  {label}
                </th>
              ))}
              <th className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[80px]">
                {t('result', 'colTotal')}
              </th>
              <th className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[100px]">
                {t('result', 'unitPriceYen')}
              </th>
              <th className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[110px]">
                {t('result', 'lineTotalYen')}
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdownSections.map((sec) => (
              <Fragment key={sec.key}>
                <tr className="bg-slate-200/95 border-t border-slate-300">
                  <td
                    colSpan={tableColSpan}
                    className="py-2 px-4 text-sm font-bold text-slate-900 tracking-wide"
                  >
                    {locale === 'ja' && '辺 '}
                    {locale === 'fr' && 'Arête '}
                    {locale === 'en' && 'Edge '}
                    <span className="font-mono">{sec.chord}</span>
                    {' — '}
                    {sec.lengthMm.toLocaleString()} mm
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
                {sec.rows.map((row) => {
                  const price = prices[row.code] || 0;
                  return (
                    <tr key={row.key} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-4 bg-white" />
                      <td className="py-2.5 px-4 bg-white" />
                      <td className="py-2.5 px-4 font-medium text-gray-800">{row.material}</td>
                      <td className="py-2.5 px-3 text-gray-700">{row.spec}</td>
                      <td className="py-2.5 px-3 text-center text-gray-700">{row.unit}</td>
                      {row.levelQty.map((qty, idx) => (
                        <td key={`${row.key}-lv${idx}`} className="py-2.5 px-3 text-right font-mono text-gray-700">
                          {qty.toLocaleString()}
                        </td>
                      ))}
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                        {row.total.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {editingPrice === row.code ? (
                          <input
                            type="number"
                            value={priceValue}
                            onChange={(e) => setPriceValue(e.target.value)}
                            onBlur={() => handlePriceSubmit(row.code)}
                            onKeyDown={(e) => e.key === 'Enter' && handlePriceSubmit(row.code)}
                            className="w-20 border border-blue-300 rounded px-1 py-0.5 text-xs text-right font-mono"
                            autoFocus
                          />
                        ) : (
                          <span
                            className="font-mono text-gray-600 cursor-pointer hover:text-blue-600"
                            onClick={() => {
                              setEditingPrice(row.code);
                              setPriceValue(String(price || ''));
                            }}
                          >
                            {price > 0 ? `¥${price.toLocaleString()}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-700">
                        {price > 0 ? `¥${(row.total * price).toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300">
              <td className="py-3 px-4 font-bold text-gray-800" colSpan={5}>
                {t('result', 'colTotal')}
              </td>
              {scaffoldLevelLabels.map((_, idx) => {
                const sum = matrixRows.reduce((acc, row) => acc + (row.levelQty[idx] || 0), 0);
                return (
                  <td key={`sum-lv-${idx}`} className="py-3 px-3 text-right font-mono font-semibold text-gray-800">
                    {sum.toLocaleString()}
                  </td>
                );
              })}
              <td className="py-3 px-3 text-right font-mono font-bold text-gray-900">
                {matrixRows.reduce((sum, row) => sum + row.total, 0).toLocaleString()}
              </td>
              <td className="py-3 px-3" />
              <td className="py-3 px-3 text-right font-mono font-bold text-gray-900">
                {totalCost > 0 ? `¥${totalCost.toLocaleString()}` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-6 py-2 text-xs text-gray-500 border-t border-gray-100 bg-gray-50">
        {t('result', 'jackBaseGroundOnlyNote')}
      </div>
    </div>
  );
}
