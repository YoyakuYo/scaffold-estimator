'use client';

import { useState, useEffect } from 'react';
import { mToMm, mmToM } from '@/lib/dimension-meters';

function formatMetersFromMm(mm: number): string {
  if (!Number.isFinite(mm) || mm < 0) return '';
  if (mm === 0) return '0';
  const m = mmToM(mm);
  return String(Number(m.toFixed(4)));
}

type Props = {
  valueMm: number;
  onCommitMm: (mm: number) => void;
  minMm?: number;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

/**
 * Meters in the UI, millimeters in app state — allows clear/select-all/delete without controlled-number quirks.
 */
export function MeterTextInput({
  valueMm,
  onCommitMm,
  minMm = 600,
  className,
  disabled,
  'aria-label': ariaLabel,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(null);
  }, [valueMm, focused]);

  const display = focused && draft !== null ? draft : formatMetersFromMm(valueMm);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      value={display}
      onChange={(e) => {
        setFocused(true);
        setDraft(e.target.value);
      }}
      onFocus={() => {
        setFocused(true);
        setDraft(formatMetersFromMm(valueMm));
      }}
      onBlur={() => {
        setFocused(false);
        const raw = (draft ?? '').trim().replace(',', '.');
        setDraft(null);
        if (raw === '' || raw === '-' || raw === '.') {
          onCommitMm(valueMm);
          return;
        }
        const m = parseFloat(raw);
        if (!Number.isFinite(m)) {
          onCommitMm(valueMm);
          return;
        }
        onCommitMm(Math.max(minMm, mToMm(m)));
      }}
    />
  );
}

type MmProps = {
  valueMm: number;
  onCommitMm: (mm: number) => void;
  minMm?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

/** Integer mm — same typing fix as meters. */
export function MmIntegerTextInput({
  valueMm,
  onCommitMm,
  minMm = 0,
  className,
  disabled,
  'aria-label': ariaLabel,
}: MmProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(null);
  }, [valueMm, focused]);

  const display =
    focused && draft !== null
      ? draft
      : Number.isFinite(valueMm)
        ? String(Math.round(valueMm))
        : '';

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      value={display}
      onChange={(e) => {
        setFocused(true);
        setDraft(e.target.value);
      }}
      onFocus={() => {
        setFocused(true);
        setDraft(Number.isFinite(valueMm) ? String(Math.round(valueMm)) : '');
      }}
      onBlur={() => {
        setFocused(false);
        const raw = (draft ?? '').trim();
        setDraft(null);
        if (raw === '' || raw === '-') {
          onCommitMm(valueMm);
          return;
        }
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n)) {
          onCommitMm(valueMm);
          return;
        }
        onCommitMm(Math.max(minMm, n));
      }}
    />
  );
}

type OptionalMmProps = {
  valueMm: number | undefined | null;
  onCommitMm: (mm: number | undefined) => void;
  minMm?: number;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
};

/** Optional integer mm — empty on blur clears (undefined). */
export function OptionalMmIntegerTextInput({
  valueMm,
  onCommitMm,
  minMm = 1,
  className,
  disabled,
  placeholder,
  'aria-label': ariaLabel,
}: OptionalMmProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(null);
  }, [valueMm, focused]);

  const display =
    focused && draft !== null
      ? draft
      : valueMm != null && Number.isFinite(valueMm)
        ? String(Math.round(valueMm))
        : '';

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      value={display}
      onChange={(e) => {
        setFocused(true);
        setDraft(e.target.value);
      }}
      onFocus={() => {
        setFocused(true);
        setDraft(
          valueMm != null && Number.isFinite(valueMm) ? String(Math.round(valueMm)) : '',
        );
      }}
      onBlur={() => {
        setFocused(false);
        const raw = (draft ?? '').trim();
        setDraft(null);
        if (raw === '' || raw === '-') {
          onCommitMm(undefined);
          return;
        }
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n)) {
          onCommitMm(valueMm ?? undefined);
          return;
        }
        onCommitMm(Math.max(minMm, n));
      }}
    />
  );
}

type OptionalMeterProps = {
  valueMm: number | null | undefined;
  onCommitMm: (mm: number | null) => void;
  minMm?: number;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

/** Optional meters (mm in state) — empty on blur clears (null). */
export function OptionalMeterTextInput({
  valueMm,
  onCommitMm,
  minMm = 1,
  className,
  disabled,
  'aria-label': ariaLabel,
}: OptionalMeterProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(null);
  }, [valueMm, focused]);

  const display =
    focused && draft !== null
      ? draft
      : valueMm != null && Number.isFinite(valueMm) && valueMm > 0
        ? formatMetersFromMm(valueMm)
        : '';

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      value={display}
      onChange={(e) => {
        setFocused(true);
        setDraft(e.target.value);
      }}
      onFocus={() => {
        setFocused(true);
        setDraft(
          valueMm != null && Number.isFinite(valueMm) && valueMm > 0
            ? formatMetersFromMm(valueMm)
            : '',
        );
      }}
      onBlur={() => {
        setFocused(false);
        const raw = (draft ?? '').trim().replace(',', '.');
        setDraft(null);
        if (raw === '' || raw === '-' || raw === '.') {
          onCommitMm(null);
          return;
        }
        const m = parseFloat(raw);
        if (!Number.isFinite(m)) {
          onCommitMm(valueMm ?? null);
          return;
        }
        onCommitMm(Math.max(minMm, mToMm(m)));
      }}
    />
  );
}
