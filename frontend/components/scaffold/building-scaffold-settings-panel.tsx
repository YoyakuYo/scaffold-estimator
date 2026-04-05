'use client';

import { Building2, MapPin } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { CreateScaffoldConfigDto, ScaffoldRules } from '@/lib/api/scaffold-configs';

const WAKUGUMI_FIXED_FRAME_HEIGHT_MM = 1700;

type WakugumiFrameSeriesId = NonNullable<CreateScaffoldConfigDto['wakugumiFrameSeries']>;

function scaffoldWidthMmFromWakugumiSeries(s: WakugumiFrameSeriesId): 600 | 900 | 1200 {
  if (s === 'FT617') return 600;
  if (s === 'FT917') return 900;
  return 1200;
}

function wakugumiSeriesFromScaffoldWidthMm(w: number): WakugumiFrameSeriesId {
  if (w <= 600) return 'FT617';
  if (w <= 900) return 'FT917';
  return 'FT1217';
}

export interface SiteContactFieldsProps {
  siteName: string;
  setSiteName: (v: string) => void;
  siteAddress: string;
  setSiteAddress: (v: string) => void;
  siteEmail: string;
  setSiteEmail: (v: string) => void;
  sitePhone: string;
  setSitePhone: (v: string) => void;
  siteFax: string;
  setSiteFax: (v: string) => void;
}

/** Site / contact fields only (parent supplies section title when needed). */
export function SiteContactFields({
  siteName,
  setSiteName,
  siteAddress,
  setSiteAddress,
  siteEmail,
  setSiteEmail,
  sitePhone,
  setSitePhone,
  siteFax,
  setSiteFax,
}: SiteContactFieldsProps) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('scaffold', 'siteName')}</label>
          <input
            type="text"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            placeholder={t('scaffold', 'siteNamePlaceholder')}
            autoComplete="organization"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('scaffold', 'siteAddress')}</label>
          <input
            type="text"
            value={siteAddress}
            onChange={(e) => setSiteAddress(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            placeholder={t('scaffold', 'siteAddressPlaceholder')}
            autoComplete="street-address"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('scaffold', 'siteEmail')}</label>
          <input
            type="email"
            value={siteEmail}
            onChange={(e) => setSiteEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            placeholder="name@example.com"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('scaffold', 'sitePhone')}</label>
          <input
            type="tel"
            value={sitePhone}
            onChange={(e) => setSitePhone(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            autoComplete="tel"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('scaffold', 'siteFax')}</label>
          <input
            type="tel"
            value={siteFax}
            onChange={(e) => setSiteFax(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
  );
}

export interface BuildingScaffoldSettingsPanelProps extends Partial<SiteContactFieldsProps> {
  /** When false, hides site/contact fields (collect on result page before Excel). Default true. */
  showSiteContact?: boolean;
  rules: ScaffoldRules | undefined;
  buildingHeightMm: number | null;
  setBuildingHeightMm: (v: number | null) => void;
  scaffoldType: 'kusabi' | 'wakugumi';
  setScaffoldType: (v: 'kusabi' | 'wakugumi') => void;
  structureType: '改修工事' | 'S造' | 'RC造';
  setStructureType: (v: '改修工事' | 'S造' | 'RC造') => void;
  scaffoldWidthMm: number;
  setScaffoldWidthMm: (v: number) => void;
  wakugumiFrameSeries: WakugumiFrameSeriesId;
  setWakugumiFrameSeries: (v: WakugumiFrameSeriesId) => void;
  preferredMainTatejiMm: number;
  setPreferredMainTatejiMm: (v: number) => void;
  habakiCountPerSpan: number;
  setHabakiCountPerSpan: (v: number) => void;
  endStopperType: 'nuno' | 'frame';
  setEndStopperType: (v: 'nuno' | 'frame') => void;
  setFrameSizeMm: (v: number) => void;
}

export function BuildingScaffoldSettingsPanel({
  showSiteContact = true,
  siteName = '',
  setSiteName = () => {},
  siteAddress = '',
  setSiteAddress = () => {},
  siteEmail = '',
  setSiteEmail = () => {},
  sitePhone = '',
  setSitePhone = () => {},
  siteFax = '',
  setSiteFax = () => {},
  rules,
  buildingHeightMm,
  setBuildingHeightMm,
  scaffoldType,
  setScaffoldType,
  structureType,
  setStructureType,
  scaffoldWidthMm,
  setScaffoldWidthMm,
  wakugumiFrameSeries,
  setWakugumiFrameSeries,
  preferredMainTatejiMm,
  setPreferredMainTatejiMm,
  habakiCountPerSpan,
  setHabakiCountPerSpan,
  endStopperType,
  setEndStopperType,
  setFrameSizeMm,
}: BuildingScaffoldSettingsPanelProps) {
  const { t, locale } = useI18n();

  return (
    <div className="max-w-[1600px] mx-auto px-4 mb-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-blue-600" />
          {t('scaffold', 'buildingSettings')}
        </h2>

        {showSiteContact ? (
          <div className="mb-6 pb-6 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600" />
              {t('scaffold', 'siteInfoSection')}
            </h3>
            <SiteContactFields
              siteName={siteName}
              setSiteName={setSiteName}
              siteAddress={siteAddress}
              setSiteAddress={setSiteAddress}
              siteEmail={siteEmail}
              setSiteEmail={setSiteEmail}
              sitePhone={sitePhone}
              setSitePhone={setSitePhone}
              siteFax={siteFax}
              setSiteFax={setSiteFax}
            />
          </div>
        ) : null}

        <div className="mb-6 pb-6 border-b border-gray-200">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t('scaffold', 'defaultHeightForDrawingMm')}
            </label>
            <div className="flex items-center gap-2 max-w-xs">
              <input
                type="number"
                min={1}
                step={0.01}
                value={
                  buildingHeightMm != null && buildingHeightMm > 0
                    ? Math.round((buildingHeightMm / 1000) * 1000) / 1000
                    : ''
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setBuildingHeightMm(null);
                    return;
                  }
                  const m = Number(raw);
                  if (!Number.isFinite(m) || m <= 0) return;
                  setBuildingHeightMm(Math.round(m * 1000));
                }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                placeholder="3"
              />
              <span className="text-sm text-gray-500 shrink-0">m</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('scaffold', 'defaultHeightDrawingHint')}</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('scaffoldExtra', 'scaffoldType')}</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setScaffoldType('kusabi')}
              className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                scaffoldType === 'kusabi'
                  ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
              }`}
            >
              <div>{t('scaffold', 'kusabiType')}</div>
            </button>
            <button
              type="button"
              onClick={() => {
                setScaffoldType('wakugumi');
                const s = wakugumiSeriesFromScaffoldWidthMm(scaffoldWidthMm);
                setWakugumiFrameSeries(s);
                setScaffoldWidthMm(scaffoldWidthMmFromWakugumiSeries(s));
                setFrameSizeMm(WAKUGUMI_FIXED_FRAME_HEIGHT_MM);
              }}
              className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                scaffoldType === 'wakugumi'
                  ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-sm'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
              }`}
            >
              <div>{t('scaffold', 'wakugumiType')}</div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('scaffold', 'structureType')}</label>
            <select
              value={structureType}
              onChange={(e) => setStructureType(e.target.value as '改修工事' | 'S造' | 'RC造')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="改修工事">{t('scaffold', 'structureTypeRenovation')} (1.25x)</option>
              <option value="S造">{t('scaffold', 'structureTypeSteel')} (1.0x)</option>
              <option value="RC造">{t('scaffold', 'structureTypeConcrete')} (0.9x)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">{t('scaffold', 'structureTypeHint')}</p>
          </div>

          {scaffoldType === 'kusabi' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('scaffold', 'scaffoldWidth')}</label>
              <select
                value={scaffoldWidthMm}
                onChange={(e) => setScaffoldWidthMm(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(rules?.scaffoldWidths || [
                  { value: 600, label: '600mm' },
                  { value: 900, label: '900mm' },
                  { value: 1200, label: '1200mm' },
                ]).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scaffoldType === 'wakugumi' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('scaffoldExtra', 'wakugumiFrameSeries')}
              </label>
              <select
                value={wakugumiFrameSeries}
                onChange={(e) => {
                  const s = e.target.value as WakugumiFrameSeriesId;
                  setWakugumiFrameSeries(s);
                  setScaffoldWidthMm(scaffoldWidthMmFromWakugumiSeries(s));
                }}
                className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
              >
                {(rules?.wakugumi?.frameSeriesOptions ?? [
                  { value: 'FT617' as const, label: 'FT-617 (610mm)', labelJp: 'FT-617（幅610mm）' },
                  { value: 'FT917' as const, label: 'FT-917 (914mm)', labelJp: 'FT-917（幅914mm）' },
                  { value: 'FT1217' as const, label: 'FT-1217 (1219mm)', labelJp: 'FT-1217（幅1219mm）' },
                ]).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {locale === 'ja' ? opt.labelJp : opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {t('scaffold', 'scaffoldWidth')}: {scaffoldWidthMm}mm
              </p>
            </div>
          )}

          {scaffoldType === 'kusabi' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('scaffold', 'postSize')}</label>
              <select
                value={preferredMainTatejiMm}
                onChange={(e) => setPreferredMainTatejiMm(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(rules?.mainTatejiOptions || [
                  { value: 1800, label: '1800mm' },
                  { value: 2700, label: '2700mm' },
                  { value: 3600, label: '3600mm' },
                ]).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scaffoldType === 'wakugumi' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('scaffoldExtra', 'frameSize')}</label>
                <div className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm bg-orange-50/30 text-gray-800">
                  {WAKUGUMI_FIXED_FRAME_HEIGHT_MM}mm (FT-17)
                </div>
                <p className="text-xs text-gray-500 mt-1">{t('scaffoldExtra', 'frameHeightFixed1700')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('scaffoldExtra', 'habakiCount')}</label>
                <select
                  value={habakiCountPerSpan}
                  onChange={(e) => setHabakiCountPerSpan(Number(e.target.value))}
                  className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                >
                  {(rules?.wakugumi?.habakiCountOptions || [
                    { value: 1, label: t('scaffold', 'habakiSingle') },
                    { value: 2, label: t('scaffold', 'habakiDouble') },
                  ]).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('scaffoldExtra', 'endStopper')}</label>
                <select
                  value={endStopperType}
                  onChange={(e) => setEndStopperType(e.target.value as 'nuno' | 'frame')}
                  className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-orange-50/30"
                >
                  {(rules?.wakugumi?.endStopperTypeOptions || [
                    { value: 'nuno', label: t('scaffold', 'endStopperNuno') },
                    { value: 'frame', label: t('scaffold', 'endStopperFrame') },
                  ]).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
