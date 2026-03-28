'use client';

import { useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

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

interface Props {
  walls: WallResult[];
  summary: CalculatedComponent[];
  buildingHeightMm: number;
  scaffoldWidthMm: number;
  totalLevels: number;
  levelHeightMm?: number;
  onPriceChange?: (materialCode: string, price: number) => void;
  prices?: Record<string, number>;
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
}: Props) {
  const { t, locale } = useI18n();
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');

  const floorCount = useMemo(() => {
    return Math.max(1, totalLevels || Math.ceil(buildingHeightMm / levelHeightMm));
  }, [buildingHeightMm, levelHeightMm, totalLevels]);

  const floorLabels = useMemo(
    () => Array.from({ length: floorCount }, (_, i) => `${t('result', 'floorPrefix')}${i + 1}`),
    [floorCount, t],
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

  const inferLineRun = (wall: WallResult) => {
    const raw = (wall.sideJp || wall.side || '').trim();
    const slashMatch = raw.match(/(Y\d+)\s*\/\s*(X\d+\s*-\s*X\d+)/i);
    if (slashMatch) {
      return {
        line: slashMatch[1].toUpperCase(),
        run: slashMatch[2].toUpperCase().replace(/\s+/g, ''),
      };
    }
    const match = raw.match(/(Y\d+).*(X\d+\s*-\s*X\d+)|(X\d+\s*-\s*X\d+).*(Y\d+)/i);
    if (match) {
      return {
        line: (match[1] || match[4] || raw).toUpperCase(),
        run: (match[2] || match[3] || '-').toUpperCase().replace(/\s+/g, ''),
      };
    }
    return { line: raw || '-', run: '-' };
  };

  const distributeByFloor = (comp: CalculatedComponent, wallLevels: number): number[] => {
    const rows = Array.from({ length: floorCount }, () => 0);
    const levels = Math.max(1, wallLevels);
    const qty = Math.max(0, Math.round(comp.quantity || 0));
    if (qty <= 0) return rows;

    // Jack base must be counted only on ground floor.
    if (comp.type === 'jack_base') {
      rows[0] = qty;
      return rows;
    }

    // Top guard posts are installed at top active level.
    if (comp.type === 'post_top') {
      rows[Math.min(levels - 1, floorCount - 1)] = qty;
      return rows;
    }

    const visibleLevels = Math.min(levels, floorCount);
    const baseQty = Math.floor(qty / levels);
    let rem = qty - baseQty * levels;
    for (let i = 0; i < visibleLevels; i++) {
      rows[i] = baseQty + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
    }
    if (levels > floorCount) {
      rows[floorCount - 1] += baseQty * (levels - floorCount);
      if (rem > 0) rows[floorCount - 1] += rem;
    }
    return rows;
  };

  const matrixRows = useMemo(() => {
    const rows: Array<{
      key: string;
      line: string;
      run: string;
      material: string;
      spec: string;
      unit: string;
      floorQty: number[];
      total: number;
      code: string;
    }> = [];

    for (const wall of walls) {
      const wallLevels = wall.levelCalc?.fullLevels || 1;
      const { line, run } = inferLineRun(wall);
      for (const comp of wall.components) {
        const floorQty = distributeByFloor(comp, wallLevels);
        rows.push({
          key: `${wall.side}::${comp.type}::${comp.sizeSpec}`,
          line,
          run,
          material: translateMaterialName(comp),
          spec: comp.sizeSpec || '-',
          unit: comp.unit || '-',
          floorQty,
          total: floorQty.reduce((sum, n) => sum + n, 0),
          code: comp.materialCode || comp.type,
        });
      }
    }
    return rows;
  }, [walls, floorCount, locale]);

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
        <span>{t('result', 'floors')}: {floorCount}</span>
        <span>{t('result', 'walls')}: {walls.length}</span>
      </div>

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
              {floorLabels.map((label) => (
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
            {matrixRows.map((row) => {
              const price = prices[row.code] || 0;
              return (
                <tr key={row.key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2.5 px-4 text-gray-700">{row.line}</td>
                  <td className="py-2.5 px-4 font-mono text-gray-700">{row.run}</td>
                  <td className="py-2.5 px-4 font-medium text-gray-800">{row.material}</td>
                  <td className="py-2.5 px-3 text-gray-700">{row.spec}</td>
                  <td className="py-2.5 px-3 text-center text-gray-700">{row.unit}</td>
                  {row.floorQty.map((qty, idx) => (
                    <td key={`${row.key}-f${idx}`} className="py-2.5 px-3 text-right font-mono text-gray-700">
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
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300">
              <td className="py-3 px-4 font-bold text-gray-800" colSpan={5}>
                {t('result', 'colTotal')}
              </td>
              {floorLabels.map((_, idx) => {
                const sum = matrixRows.reduce((acc, row) => acc + (row.floorQty[idx] || 0), 0);
                return (
                  <td key={`sum-floor-${idx}`} className="py-3 px-3 text-right font-mono font-semibold text-gray-800">
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
