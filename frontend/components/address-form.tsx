'use client';

import { useState, useCallback } from 'react';
import { Search, Loader2, CheckCircle } from 'lucide-react';
import { lookupPostalCode, formatPostalCode, PREFECTURES } from '@/lib/postal-code';
import { useI18n } from '@/lib/i18n';

export interface AddressFields {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
  addressLine: string;
  building: string;
}

interface AddressFormProps {
  value: AddressFields;
  onChange: (fields: AddressFields) => void;
  disabled?: boolean;
}

export function AddressForm({ value, onChange, disabled }: AddressFormProps) {
  const { locale, t } = useI18n();
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState(false);

  const handlePostalCodeChange = useCallback(
    (raw: string) => {
      const formatted = formatPostalCode(raw);
      onChange({ ...value, postalCode: formatted });
      setFound(false);

      const digits = raw.replace(/[^0-9]/g, '');
      if (digits.length === 7) {
        setLooking(true);
        lookupPostalCode(digits).then((result) => {
          setLooking(false);
          if (result) {
            setFound(true);
            onChange({
              ...value,
              postalCode: formatPostalCode(result.postalCode),
              prefecture: result.prefecture,
              city: result.city,
              town: result.town,
              addressLine: value.addressLine,
              building: value.building,
            });
            setTimeout(() => setFound(false), 2000);
          }
        });
      }
    },
    [value, onChange],
  );

  const handleLookup = useCallback(() => {
    const digits = value.postalCode.replace(/[^0-9]/g, '');
    if (digits.length !== 7) return;
    setLooking(true);
    lookupPostalCode(digits).then((result) => {
      setLooking(false);
      if (result) {
        setFound(true);
        onChange({
          ...value,
          prefecture: result.prefecture,
          city: result.city,
          town: result.town,
        });
        setTimeout(() => setFound(false), 2000);
      }
    });
  }, [value, onChange]);

  const set = (field: keyof AddressFields, v: string) => {
    onChange({ ...value, [field]: v });
  };

  const ja = locale === 'ja';

  return (
    <div className="space-y-3">
      {/* Postal Code */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('address', 'postalCode')}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">〒</span>
            <input
              type="text"
              maxLength={8}
              placeholder="000-0000"
              value={value.postalCode}
              onChange={(e) => handlePostalCodeChange(e.target.value)}
              disabled={disabled}
              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
            />
          </div>
          <button
            type="button"
            onClick={handleLookup}
            disabled={disabled || looking || value.postalCode.replace(/[^0-9]/g, '').length !== 7}
            className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm whitespace-nowrap"
          >
            {looking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : found ? (
              <CheckCircle className="h-4 w-4 text-green-300" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {t('address', 'lookup')}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {t('address', 'autoFillHint')}
        </p>
      </div>

      {/* Prefecture */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('address', 'prefecture')}
        </label>
        <select
          value={value.prefecture}
          onChange={(e) => set('prefecture', e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
        >
          <option value="">{t('address', 'selectPrefecture')}</option>
          {PREFECTURES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* City / Ward */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('address', 'city')}
        </label>
        <input
          type="text"
          value={value.city}
          onChange={(e) => set('city', e.target.value)}
          disabled={disabled}
          placeholder={ja ? '例: 千代田区' : 'e.g. Chiyoda-ku'}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
        />
      </div>

      {/* Town area */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('address', 'town')}
        </label>
        <input
          type="text"
          value={value.town}
          onChange={(e) => set('town', e.target.value)}
          disabled={disabled}
          placeholder={ja ? '例: 千代田' : 'e.g. Chiyoda'}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
        />
      </div>

      {/* Street / Block number */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('address', 'street')}
        </label>
        <input
          type="text"
          value={value.addressLine}
          onChange={(e) => set('addressLine', e.target.value)}
          disabled={disabled}
          placeholder={ja ? '例: 1-1-1' : 'e.g. 1-1-1'}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
        />
      </div>

      {/* Building name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('address', 'buildingRoom')}
        </label>
        <input
          type="text"
          value={value.building}
          onChange={(e) => set('building', e.target.value)}
          disabled={disabled}
          placeholder={ja ? '例: ○○ビル 3F' : 'e.g. ABC Bldg. 3F'}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
        />
      </div>
    </div>
  );
}
