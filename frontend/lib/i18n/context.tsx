'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { type Locale, type TranslationKeys, type TranslationSection, translations } from './translations';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: <S extends TranslationSection>(section: S, key: keyof TranslationKeys[S]) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = 'zoomen-locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  // Initialize with 'ja' to match server-side render
  // This prevents hydration mismatches - locale will update after mount if different
  const [locale, setLocaleState] = useState<Locale>('ja');

  // Load saved locale after mount (client-side only)
  // This runs after hydration, so suppressHydrationWarning is needed on translated elements
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'ja') {
        setLocaleState(saved);
      }
    } catch {
      // ignore SSR / storage errors
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    <S extends TranslationSection>(section: S, key: keyof TranslationKeys[S]): string => {
      const sectionObj = translations[section];
      const entry = sectionObj[key] as Record<Locale, string> | undefined;
      if (!entry) return `[${String(section)}.${String(key)}]`;
      return entry[locale] ?? entry['ja'] ?? `[${String(section)}.${String(key)}]`;
    },
    [locale],
  );

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
