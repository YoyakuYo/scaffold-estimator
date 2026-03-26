'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Layers, Package } from 'lucide-react';

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

interface FloorBreakdown {
  floorLabel: string;
  floorIndex: number;
  baseHeightMm: number;
  topHeightMm: number;
  components: Record<string, number>;
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
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');

  const toggleMaterial = (code: string) => {
    setExpandedMaterials((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // Compute floor count from building height and level height
  const floorCount = useMemo(() => {
    return Math.max(1, Math.ceil(buildingHeightMm / levelHeightMm));
  }, [buildingHeightMm, levelHeightMm]);

  // Break down quantities per floor per wall side
  const perFloorPerSide = useMemo(() => {
    const breakdown: Record<
      string,
      { total: number; perWall: Record<string, { total: number; perFloor: number[] }> }
    > = {};

    for (const comp of summary) {
      const key = `${comp.nameJp} (${comp.sizeSpec})`;
      if (!breakdown[key]) {
        breakdown[key] = { total: comp.quantity, perWall: {} };
      } else {
        breakdown[key].total = comp.quantity;
      }
    }

    // Distribute per wall
    for (const wall of walls) {
      const wallLevels = wall.levelCalc?.fullLevels || 1;
      for (const comp of wall.components) {
        const key = `${comp.nameJp} (${comp.sizeSpec})`;
        if (!breakdown[key]) {
          breakdown[key] = { total: comp.quantity, perWall: {} };
        }
        const wallKey = wall.sideJp || wall.side;

        // Distribute evenly across floors for this wall
        const perFloor: number[] = [];
        for (let f = 0; f < floorCount; f++) {
          if (f < wallLevels) {
            perFloor.push(Math.round(comp.quantity / wallLevels));
          } else {
            perFloor.push(0);
          }
        }
        // Adjust rounding: put remainder on first floor
        const distributed = perFloor.reduce((a, b) => a + b, 0);
        if (distributed < comp.quantity && perFloor.length > 0) {
          perFloor[0] += comp.quantity - distributed;
        }

        breakdown[key].perWall[wallKey] = {
          total: comp.quantity,
          perFloor,
        };
      }
    }

    return breakdown;
  }, [summary, walls, floorCount]);

  const wallLabels = useMemo(
    () => walls.map((w) => w.sideJp || w.side),
    [walls],
  );

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
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Package className="h-5 w-5" />
          材料明細表 (Per-Floor Per-Side Breakdown)
        </h3>
        {totalCost > 0 && (
          <span className="text-white/90 text-sm font-mono">
            合計: ¥{totalCost.toLocaleString()}
          </span>
        )}
      </div>

      {/* Info bar */}
      <div className="bg-blue-50 px-6 py-2 border-b border-blue-100 flex items-center gap-6 text-xs text-blue-700">
        <span>建物高さ: {(buildingHeightMm / 1000).toFixed(1)}m</span>
        <span>足場幅: {scaffoldWidthMm}mm</span>
        <span>総段数: {totalLevels}</span>
        <span>階数: {floorCount}</span>
        <span>壁面数: {walls.length}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-200">
              <th className="text-left py-3 px-4 font-semibold text-gray-700 sticky left-0 bg-gray-100 z-10 min-w-[250px]">
                材料名 / Material
              </th>
              <th className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[80px]">合計</th>
              <th className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[80px]">単価 (¥)</th>
              <th className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[80px]">金額 (¥)</th>
              {wallLabels.map((label) => (
                <th key={label} className="text-right py-3 px-3 font-semibold text-gray-700 min-w-[80px]">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(perFloorPerSide).map(([materialKey, data]) => {
              const isExpanded = expandedMaterials.has(materialKey);
              const comp = summary.find(
                (c) => `${c.nameJp} (${c.sizeSpec})` === materialKey,
              );
              const code = comp?.materialCode || comp?.type || materialKey;
              const price = prices[code] || 0;

              return (
                <>{/* Rewritten as fragment to support expandable rows */}
                  <tr
                    key={materialKey}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleMaterial(materialKey)}
                  >
                    <td className="py-2.5 px-4 sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                        )}
                        <span className="font-medium text-gray-800">{materialKey}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                      {data.total.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {editingPrice === code ? (
                        <input
                          type="number"
                          value={priceValue}
                          onChange={(e) => setPriceValue(e.target.value)}
                          onBlur={() => handlePriceSubmit(code)}
                          onKeyDown={(e) => e.key === 'Enter' && handlePriceSubmit(code)}
                          className="w-20 border border-blue-300 rounded px-1 py-0.5 text-xs text-right font-mono"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="font-mono text-gray-600 cursor-pointer hover:text-blue-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPrice(code);
                            setPriceValue(String(price || ''));
                          }}
                        >
                          {price > 0 ? `¥${price.toLocaleString()}` : '—'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-gray-700">
                      {price > 0 ? `¥${(data.total * price).toLocaleString()}` : '—'}
                    </td>
                    {wallLabels.map((label) => (
                      <td key={label} className="py-2.5 px-3 text-right font-mono text-gray-600">
                        {data.perWall[label]?.total?.toLocaleString() || '—'}
                      </td>
                    ))}
                  </tr>
                  {/* Expanded: per-floor breakdown */}
                  {isExpanded && wallLabels.map((wallLabel) => {
                    const wallData = data.perWall[wallLabel];
                    if (!wallData) return null;
                    return wallData.perFloor.map((qty, fi) =>
                      qty > 0 ? (
                        <tr
                          key={`${materialKey}-${wallLabel}-F${fi}`}
                          className="bg-blue-50/50 border-b border-blue-100/50"
                        >
                          <td className="py-1.5 px-4 pl-12 sticky left-0 bg-blue-50/50 z-10">
                            <span className="text-xs text-blue-600">
                              {wallLabel} → {fi + 1}F ({(fi * levelHeightMm / 1000).toFixed(1)}m~{((fi + 1) * levelHeightMm / 1000).toFixed(1)}m)
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono text-xs text-blue-700">
                            {qty.toLocaleString()}
                          </td>
                          <td className="py-1.5 px-3" />
                          <td className="py-1.5 px-3 text-right font-mono text-xs text-blue-600">
                            {price > 0 ? `¥${(qty * price).toLocaleString()}` : ''}
                          </td>
                          {wallLabels.map((wl) => (
                            <td key={wl} className="py-1.5 px-3 text-right font-mono text-xs text-blue-500">
                              {wl === wallLabel ? qty.toLocaleString() : ''}
                            </td>
                          ))}
                        </tr>
                      ) : null,
                    );
                  })}
                </>
              );
            })}
          </tbody>
          {/* Footer totals */}
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300">
              <td className="py-3 px-4 font-bold text-gray-800 sticky left-0 bg-gray-100 z-10">
                合計
              </td>
              <td className="py-3 px-3 text-right font-mono font-bold text-gray-900">
                {summary.reduce((s, c) => s + c.quantity, 0).toLocaleString()}
              </td>
              <td className="py-3 px-3" />
              <td className="py-3 px-3 text-right font-mono font-bold text-gray-900">
                {totalCost > 0 ? `¥${totalCost.toLocaleString()}` : '—'}
              </td>
              {wallLabels.map((label) => {
                const wallTotal = walls.find(
                  (w) => (w.sideJp || w.side) === label,
                )?.components.reduce((s, c) => s + c.quantity, 0) || 0;
                return (
                  <td key={label} className="py-3 px-3 text-right font-mono font-semibold text-gray-700">
                    {wallTotal.toLocaleString()}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
