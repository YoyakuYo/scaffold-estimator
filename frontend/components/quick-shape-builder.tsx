'use client';

import { useState, useCallback } from 'react';
import {
  Square,
  CornerDownRight,
  Pentagon,
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Calculator,
  Building2,
  Ruler,
  ArrowRight,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────

type ShapeType = 'rectangle' | 'l-shape' | 'custom';

interface SideDefinition {
  label: string;
  lengthMm: number;
}

interface KaidanConfig {
  enabled: boolean;
  count: number;
}

export interface QuickShapeConfig {
  shapeType: ShapeType;
  sides: SideDefinition[];
  buildingHeightMm: number;
  levelHeightMm: number;
  scaffoldType: 'kusabi' | 'wakugumi';
  scaffoldWidthMm: number;
  preferredMainTatejiMm: number;
  topGuardHeightMm: number;
  frameSizeMm: number;
  habakiCountPerSpan: number;
  endStopperType: 'nuno' | 'frame';
  structureType: '改修工事' | 'S造' | 'RC造';
  kaidanPerSide: Record<string, KaidanConfig>;
}

interface Props {
  onSubmit: (config: QuickShapeConfig) => void;
  isCalculating?: boolean;
}

// ─── Component ───────────────────────────────────────────────

export function QuickShapeBuilder({ onSubmit, isCalculating }: Props) {
  const [step, setStep] = useState(1);
  const [shapeType, setShapeType] = useState<ShapeType>('rectangle');

  // Rectangle inputs
  const [rectNorth, setRectNorth] = useState(10000);
  const [rectEast, setRectEast] = useState(8000);
  const [rectSouth, setRectSouth] = useState(10000);
  const [rectWest, setRectWest] = useState(8000);

  // L-shape inputs
  const [lSegments, setLSegments] = useState<SideDefinition[]>([
    { label: 'AB', lengthMm: 10000 },
    { label: 'BC', lengthMm: 5000 },
    { label: 'CD', lengthMm: 5000 },
    { label: 'DE', lengthMm: 5000 },
    { label: 'EF', lengthMm: 5000 },
    { label: 'FA', lengthMm: 10000 },
  ]);

  // Custom polygon
  const [customSegments, setCustomSegments] = useState<SideDefinition[]>([
    { label: 'AB', lengthMm: 10000 },
    { label: 'BC', lengthMm: 8000 },
    { label: 'CD', lengthMm: 10000 },
    { label: 'DA', lengthMm: 8000 },
  ]);

  // Step 2
  const [buildingHeightMm, setBuildingHeightMm] = useState(9900);
  const [levelHeightMm, setLevelHeightMm] = useState(1800);

  // Step 3
  const [scaffoldType, setScaffoldType] = useState<'kusabi' | 'wakugumi'>('kusabi');
  const [scaffoldWidthMm, setScaffoldWidthMm] = useState(600);
  const [preferredMainTatejiMm, setPreferredMainTatejiMm] = useState(1800);
  const [topGuardHeightMm, setTopGuardHeightMm] = useState(900);
  const [frameSizeMm, setFrameSizeMm] = useState(1700);
  const [habakiCountPerSpan, setHabakiCountPerSpan] = useState(2);
  const [endStopperType, setEndStopperType] = useState<'nuno' | 'frame'>('nuno');
  const [structureType, setStructureType] = useState<'改修工事' | 'S造' | 'RC造'>('改修工事');

  // Kaidan per side
  const [kaidanPerSide, setKaidanPerSide] = useState<Record<string, KaidanConfig>>({});

  const getSides = useCallback((): SideDefinition[] => {
    if (shapeType === 'rectangle') {
      return [
        { label: '北面', lengthMm: rectNorth },
        { label: '東面', lengthMm: rectEast },
        { label: '南面', lengthMm: rectSouth },
        { label: '西面', lengthMm: rectWest },
      ];
    }
    if (shapeType === 'l-shape') return lSegments;
    return customSegments;
  }, [shapeType, rectNorth, rectEast, rectSouth, rectWest, lSegments, customSegments]);

  const calculatedLevels = Math.floor(buildingHeightMm / levelHeightMm);

  const addCustomSegment = () => {
    const nextLetter = String.fromCharCode(65 + customSegments.length);
    const firstLetter = 'A';
    setCustomSegments((prev) => [
      ...prev.slice(0, -1),
      { label: `${prev[prev.length - 1]?.label?.[0] || String.fromCharCode(64 + prev.length)}${nextLetter}`, lengthMm: 5000 },
      { label: `${nextLetter}${firstLetter}`, lengthMm: 5000 },
    ]);
  };

  const removeCustomSegment = (idx: number) => {
    if (customSegments.length <= 3) return;
    setCustomSegments((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCustomSegment = (idx: number, lengthMm: number) => {
    setCustomSegments((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, lengthMm } : s)),
    );
  };

  const updateLSegment = (idx: number, lengthMm: number) => {
    setLSegments((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, lengthMm } : s)),
    );
  };

  const handleSubmit = () => {
    const sides = getSides();
    onSubmit({
      shapeType,
      sides,
      buildingHeightMm,
      levelHeightMm,
      scaffoldType,
      scaffoldWidthMm,
      preferredMainTatejiMm,
      topGuardHeightMm,
      frameSizeMm,
      habakiCountPerSpan,
      endStopperType,
      structureType,
      kaidanPerSide,
    });
  };

  const toggleKaidan = (label: string) => {
    setKaidanPerSide((prev) => ({
      ...prev,
      [label]: {
        enabled: !prev[label]?.enabled,
        count: prev[label]?.count || 1,
      },
    }));
  };

  const updateKaidanCount = (label: string, count: number) => {
    setKaidanPerSide((prev) => ({
      ...prev,
      [label]: { enabled: true, count: Math.max(0, Math.min(4, count)) },
    }));
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Step Indicator */}
      <div className="bg-slate-50 border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          {[
            { n: 1, label: '形状選択', icon: Square },
            { n: 2, label: '建物高さ', icon: Building2 },
            { n: 3, label: '足場設定', icon: Ruler },
          ].map((s, i) => (
            <button
              key={s.n}
              onClick={() => setStep(s.n)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                step === s.n
                  ? 'bg-blue-600 text-white shadow-sm'
                  : step > s.n
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              <s.icon className="h-4 w-4" />
              <span>Step {s.n}: {s.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {/* ═══ STEP 1: Shape Selection ═══ */}
        {step === 1 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">形状を選択 / Select Shape</h3>

            {/* Shape Type Selector */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { type: 'rectangle' as ShapeType, label: '矩形 / Rectangle', icon: Square },
                { type: 'l-shape' as ShapeType, label: 'L字型 / L-Shape', icon: CornerDownRight },
                { type: 'custom' as ShapeType, label: 'カスタム / Custom', icon: Pentagon },
              ].map((s) => (
                <button
                  key={s.type}
                  onClick={() => setShapeType(s.type)}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    shapeType === s.type
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <s.icon className="h-8 w-8 mx-auto mb-2" />
                  <span className="text-sm font-medium">{s.label}</span>
                </button>
              ))}
            </div>

            {/* Shape-specific Inputs */}
            {shapeType === 'rectangle' && (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: '北面 / North', value: rectNorth, setter: setRectNorth },
                  { label: '東面 / East', value: rectEast, setter: setRectEast },
                  { label: '南面 / South', value: rectSouth, setter: setRectSouth },
                  { label: '西面 / West', value: rectWest, setter: setRectWest },
                ].map((input) => (
                  <div key={input.label}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{input.label}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={input.value || ''}
                        onChange={(e) => input.setter(Number(e.target.value) || 0)}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        min={600}
                        step={100}
                      />
                      <span className="text-sm text-gray-500 w-8">mm</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {shapeType === 'l-shape' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 mb-2">L字型建物の各辺の長さを入力してください</p>
                {lSegments.map((seg, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700 w-12">{seg.label}</span>
                    <input
                      type="number"
                      value={seg.lengthMm || ''}
                      onChange={(e) => updateLSegment(i, Number(e.target.value) || 0)}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      min={600}
                      step={100}
                    />
                    <span className="text-sm text-gray-500">mm</span>
                  </div>
                ))}
              </div>
            )}

            {shapeType === 'custom' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 mb-2">ポリゴンの各辺を定義してください（自動閉合）</p>
                {customSegments.map((seg, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700 w-12">{seg.label}</span>
                    <input
                      type="number"
                      value={seg.lengthMm || ''}
                      onChange={(e) => updateCustomSegment(i, Number(e.target.value) || 0)}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      min={600}
                      step={100}
                    />
                    <span className="text-sm text-gray-500">mm</span>
                    {customSegments.length > 3 && (
                      <button
                        onClick={() => removeCustomSegment(i)}
                        className="p-1.5 text-red-400 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addCustomSegment}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-2 rounded-lg border border-dashed border-blue-300 hover:bg-blue-50"
                >
                  <Plus className="h-4 w-4" />
                  セグメント追加 / Add Segment
                </button>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
              >
                次へ / Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 2: Building Height ═══ */}
        {step === 2 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">建物高さ / Building Height</h3>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">建物の高さ (mm)</label>
                <input
                  type="number"
                  value={buildingHeightMm || ''}
                  onChange={(e) => setBuildingHeightMm(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  min={1000}
                  step={100}
                  placeholder="9900"
                />
                <p className="text-xs text-gray-500 mt-1">{(buildingHeightMm / 1000).toFixed(1)}m</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">レベル高さ (mm)</label>
                <input
                  type="number"
                  value={levelHeightMm || ''}
                  onChange={(e) => setLevelHeightMm(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  min={1000}
                  step={100}
                  placeholder="1800"
                />
              </div>
            </div>

            {/* Quick height presets */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-xs font-medium text-blue-800 mb-2">階数から高さを設定</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: '1F (3,900mm)', value: 3900 },
                  { label: '2F (6,900mm)', value: 6900 },
                  { label: '3F (9,900mm)', value: 9900 },
                  { label: '4F (12,900mm)', value: 12900 },
                  { label: '5F (15,900mm)', value: 15900 },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setBuildingHeightMm(p.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      buildingHeightMm === p.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white border-blue-300 text-blue-700 hover:bg-blue-100'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calculated levels */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">計算段数:</span>
                <span className="text-lg font-bold text-gray-900">{calculatedLevels} 段</span>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2 px-6 py-2.5 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium text-sm"
              >
                <ChevronLeft className="h-4 w-4" />
                戻る / Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
              >
                次へ / Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: Scaffold Configuration ═══ */}
        {step === 3 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">足場設定 / Scaffold Configuration</h3>

            {/* Scaffold Type */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">足場タイプ</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setScaffoldType('kusabi')}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    scaffoldType === 'kusabi'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div>くさび式足場</div>
                  <div className="text-xs font-normal mt-0.5 opacity-70">Kusabi (Wedge)</div>
                </button>
                <button
                  onClick={() => setScaffoldType('wakugumi')}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                    scaffoldType === 'wakugumi'
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <div>枠組足場</div>
                  <div className="text-xs font-normal mt-0.5 opacity-70">Wakugumi (Frame)</div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              {/* Scaffold Width */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">足場幅</label>
                <select
                  value={scaffoldWidthMm}
                  onChange={(e) => setScaffoldWidthMm(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value={600}>600mm</option>
                  <option value={900}>900mm</option>
                  <option value={1200}>1200mm</option>
                </select>
              </div>

              {/* Structure Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">構造パターン</label>
                <select
                  value={structureType}
                  onChange={(e) => setStructureType(e.target.value as typeof structureType)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="改修工事">改修工事 (1.25x)</option>
                  <option value="S造">S造 (1.0x)</option>
                  <option value="RC造">RC造 (0.9x)</option>
                </select>
              </div>

              {/* Kusabi-specific */}
              {scaffoldType === 'kusabi' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">支柱サイズ</label>
                    <select
                      value={preferredMainTatejiMm}
                      onChange={(e) => setPreferredMainTatejiMm(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1800}>1800mm</option>
                      <option value={2700}>2700mm</option>
                      <option value={3600}>3600mm</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">上部支柱</label>
                    <select
                      value={topGuardHeightMm}
                      onChange={(e) => setTopGuardHeightMm(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={900}>900mm</option>
                      <option value={1350}>1350mm</option>
                      <option value={1800}>1800mm</option>
                    </select>
                  </div>
                </>
              )}

              {/* Wakugumi-specific */}
              {scaffoldType === 'wakugumi' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">建枠サイズ</label>
                    <select
                      value={frameSizeMm}
                      onChange={(e) => setFrameSizeMm(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1700}>1700mm</option>
                      <option value={1800}>1800mm</option>
                      <option value={1900}>1900mm</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">巾木枚数</label>
                    <select
                      value={habakiCountPerSpan}
                      onChange={(e) => setHabakiCountPerSpan(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={1}>1枚 (片面)</option>
                      <option value={2}>2枚 (両面)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">端部タイプ</label>
                    <select
                      value={endStopperType}
                      onChange={(e) => setEndStopperType(e.target.value as 'nuno' | 'frame')}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="nuno">布材タイプ</option>
                      <option value="frame">枠タイプ</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Kaidan Per Side */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">階段配置 / Stair Access</h4>
              <div className="space-y-2">
                {getSides().map((side) => (
                  <div key={side.label} className="flex items-center gap-4 bg-white rounded-lg px-4 py-2.5 border border-gray-200">
                    <label className="flex items-center gap-2 cursor-pointer min-w-[120px]">
                      <input
                        type="checkbox"
                        checked={kaidanPerSide[side.label]?.enabled || false}
                        onChange={() => toggleKaidan(side.label)}
                        className="h-4 w-4 text-blue-600 rounded"
                      />
                      <span className="text-sm font-medium text-gray-700">{side.label}</span>
                    </label>
                    <span className="text-xs text-gray-500">{side.lengthMm.toLocaleString()}mm</span>
                    {kaidanPerSide[side.label]?.enabled && (
                      <div className="flex items-center gap-2 ml-auto">
                        <label className="text-xs text-gray-500">台数:</label>
                        <select
                          value={kaidanPerSide[side.label]?.count || 1}
                          onChange={(e) => updateKaidanCount(side.label, Number(e.target.value))}
                          className="rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                          {[1, 2, 3, 4].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h4 className="text-sm font-semibold text-blue-800 mb-2">設定概要</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-blue-600">形状:</span>
                  <span className="ml-1 font-medium text-blue-900">
                    {shapeType === 'rectangle' ? '矩形' : shapeType === 'l-shape' ? 'L字型' : 'カスタム'}
                  </span>
                </div>
                <div>
                  <span className="text-blue-600">高さ:</span>
                  <span className="ml-1 font-medium text-blue-900">{buildingHeightMm.toLocaleString()}mm</span>
                </div>
                <div>
                  <span className="text-blue-600">段数:</span>
                  <span className="ml-1 font-medium text-blue-900">{calculatedLevels}段</span>
                </div>
                <div>
                  <span className="text-blue-600">面数:</span>
                  <span className="ml-1 font-medium text-blue-900">{getSides().length}面</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-6 py-2.5 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium text-sm"
              >
                <ChevronLeft className="h-4 w-4" />
                戻る / Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={isCalculating}
                className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-base shadow-lg disabled:opacity-50"
              >
                <Calculator className="h-5 w-5" />
                積算実行
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
