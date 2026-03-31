'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useRef } from 'react';
import {
  Calculator,
  Building2,
  Download,
  CheckCircle,
  Target,
  TrendingUp,
  Users,
  Receipt,
  Box,
  Globe,
  LogIn,
  UserPlus,
  Ruler,
} from 'lucide-react';
import { useI18n, type Locale } from '@/lib/i18n';
import { usePwaInstall } from '@/lib/pwa-install-context';
import { usersApi } from '@/lib/api/users';
import { authApi } from '@/lib/api/auth';

const localeLabels: Record<Locale, string> = { ja: '日本語', en: 'EN', fr: 'FR' };

/** Generic construction / high-rise (Unsplash, free license). Optimized sizes via next/image. */
const LANDING_HERO_PHOTO =
  'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?q=80&w=1920&auto=format&fit=crop';

export default function LandingPage() {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const { canInstall, triggerInstall } = usePwaInstall();
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const localeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const hasToken = mounted && !!authApi.getToken();

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
    enabled: hasToken,
    staleTime: 1000 * 60 * 5,
  });
  useEffect(() => {
    if (profile) router.replace('/dashboard');
  }, [profile, router]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (localeMenuRef.current && !localeMenuRef.current.contains(e.target as Node)) setLocaleMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (mounted && profile) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ─── Landing header ─────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <Link href="/" className="text-lg font-bold text-gray-900">
              {t('landing', 'appName')}
            </Link>
            <div className="flex items-center gap-2">
              <div className="relative" ref={localeMenuRef}>
                <button
                  type="button"
                  onClick={() => setLocaleMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
                  title={t('landing', 'languageTitle')}
                >
                  <Globe className="h-4 w-4" />
                  <span suppressHydrationWarning>{localeLabels[locale]}</span>
                </button>
                {localeMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 py-1 w-28 rounded-md bg-white border border-gray-200 shadow-lg z-50">
                    {(['ja', 'en', 'fr'] as const).map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => { setLocale(loc); setLocaleMenuOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-sm font-medium ${locale === loc ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        {localeLabels[loc]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Link
                href="/login"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                <LogIn className="h-4 w-4" />
                {t('landing', 'logIn')}
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <UserPlus className="h-4 w-4" />
                {t('landing', 'register')}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* ─── Hero (photo + lightweight scaffold overlay) ──────── */}
        <section className="relative min-h-[72vh] w-full overflow-hidden bg-slate-900 text-white">
          <Image
            src={LANDING_HERO_PHOTO}
            alt={t('landing', 'heroImageAlt')}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/48 to-black/25"
            aria-hidden
          />
          <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden>
            <div className="landing-scaffold-rise absolute bottom-0 right-0 top-[16%] w-[min(46vw,540px)] max-md:top-[22%] max-md:w-[min(72vw,380px)]">
              <div
                className="relative h-full w-full border-x border-white/45 opacity-[0.4]"
                style={{
                  backgroundImage: `repeating-linear-gradient(90deg, transparent 0, transparent 27px, rgba(255,255,255,0.22) 27px, rgba(255,255,255,0.22) 28px),
                    repeating-linear-gradient(0deg, transparent 0, transparent 34px, rgba(255,255,255,0.16) 34px, rgba(255,255,255,0.16) 35px)`,
                }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(125deg,transparent_46%,rgba(255,255,255,0.11)_48.5%,rgba(255,255,255,0.11)_51.5%,transparent_54%)]" />
            </div>
          </div>

          <div className="relative z-10 mx-auto flex min-h-[72vh] max-w-6xl flex-col justify-end px-4 pb-14 pt-28 sm:px-6 sm:pb-16 lg:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/75">
              {t('landing', 'forConstruction')}
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
              {t('landing', 'heroTitle')}
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-white/90 sm:text-xl">
              {t('landing', 'heroSubtitle')}
            </p>
            <p className="mt-2 max-w-xl text-sm text-white/65">{t('landing', 'tagline')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-900/30 transition-colors hover:bg-orange-600"
              >
                {t('landing', 'heroCtaRegister')}
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl border border-white/35 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/15"
              >
                {t('landing', 'logIn')}
              </Link>
              <Link
                href="#install"
                className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-medium text-white/85 underline-offset-4 hover:text-white hover:underline"
              >
                {t('landing', 'heroCtaInstall')}
              </Link>
            </div>
          </div>

          <div className="absolute bottom-3 right-3 z-10 max-w-[min(100%-1.5rem,20rem)] text-right text-[11px] leading-snug text-white/55">
            <a
              href="https://unsplash.com/license"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-white/30 underline-offset-2 hover:text-white/80"
            >
              {t('landing', 'unsplashCredit')}
            </a>
          </div>
        </section>

        {/* ─── Three summary boxes: Input · Features · Why ──────── */}
        <section className="border-b border-gray-200 bg-white py-12 md:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-3 lg:gap-8 lg:items-stretch">
              {/* Box 1 — Drawing & manual / input summary */}
              <article className="flex h-full flex-col rounded-2xl border border-gray-200 bg-gradient-to-b from-slate-50/80 to-white p-6 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600">
                  {t('landing', 'boxInputEyebrow')}
                </p>
                <h2 className="mt-2 text-lg font-bold leading-snug text-gray-900 md:text-xl">
                  {t('landing', 'boxInputTitle')}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-gray-600">{t('features', 'coreSubtitle')}</p>
                <p className="mt-3 text-xs leading-relaxed text-gray-500">{t('landing', 'boxInputFormats')}</p>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3">
                  {[
                    { label: t('features', 'stat1Label'), value: t('features', 'stat1Value') },
                    { label: t('features', 'stat2Label'), value: t('features', 'stat2Value') },
                    { label: t('features', 'stat3Label'), value: t('features', 'stat3Value') },
                    { label: t('features', 'stat4Label'), value: t('features', 'stat4Value') },
                  ].map((chip) => (
                    <div
                      key={chip.label}
                      className="rounded-xl border border-gray-200/80 bg-white px-3 py-2.5 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                    >
                      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{chip.label}</div>
                      <div className="mt-0.5 text-sm font-semibold text-gray-900">{chip.value}</div>
                    </div>
                  ))}
                </div>
              </article>

              {/* Box 2 — Features (single card, compact grid) */}
              <article className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ring-1 ring-blue-600/10">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600">
                  {t('landing', 'boxFeaturesEyebrow')}
                </p>
                <h2 className="mt-2 text-lg font-bold text-gray-900 md:text-xl">{t('landing', 'sectionFeatures')}</h2>
                <p className="mt-2 text-xs text-gray-500">{t('landing', 'boxFeaturesIntro')}</p>
                <div className="mt-5 grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-4">
                  {[
                    { icon: Calculator, title: t('features', 'coreCalcTitle'), desc: t('features', 'coreCalcDesc'), bg: 'bg-blue-100', iconColor: 'text-blue-600' },
                    { icon: Receipt, title: t('features', 'coreQuotationTitle'), desc: t('features', 'coreQuotationDesc'), bg: 'bg-emerald-100', iconColor: 'text-emerald-600' },
                    { icon: Box, title: t('features', 'coreVisualizationTitle'), desc: t('features', 'coreVisualizationDesc'), bg: 'bg-violet-100', iconColor: 'text-violet-600' },
                    { icon: Ruler, title: t('landing', 'quickShapeTitle'), desc: t('landing', 'quickShapeDesc'), bg: 'bg-amber-100', iconColor: 'text-amber-600' },
                    { icon: Building2, title: t('landing', 'perSideTitle'), desc: t('landing', 'perSideDesc'), bg: 'bg-sky-100', iconColor: 'text-sky-600' },
                    { icon: CheckCircle, title: t('landing', 'deterministicTitle'), desc: t('landing', 'deterministicDesc'), bg: 'bg-teal-100', iconColor: 'text-teal-600' },
                  ].map((f, i) => (
                    <div key={i} className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${f.bg}`}>
                        <f.icon className={`h-[18px] w-[18px] ${f.iconColor}`} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold leading-tight text-gray-900">{f.title}</h3>
                        <p className="mt-1 text-xs leading-snug text-gray-600">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              {/* Box 3 — Why use it */}
              <article className="flex h-full flex-col rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-slate-50/90 p-6 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600">
                  {t('landing', 'boxWhyEyebrow')}
                </p>
                <h2 className="mt-2 text-lg font-bold text-gray-900 md:text-xl">{t('landing', 'sectionWhy')}</h2>
                <p className="mt-2 text-xs text-gray-500">{t('landing', 'boxWhyIntro')}</p>
                <ul className="mt-5 flex flex-1 flex-col gap-3">
                  {[
                    { icon: TrendingUp, title: t('features', 'benefit1Title'), desc: t('features', 'benefit1Desc') },
                    { icon: Target, title: t('features', 'benefit2Title'), desc: t('features', 'benefit2Desc') },
                    { icon: Users, title: t('features', 'benefit3Title'), desc: t('features', 'benefit3Desc') },
                    { icon: CheckCircle, title: t('features', 'benefit4Title'), desc: t('features', 'benefit4Desc') },
                  ].map((b, i) => (
                    <li key={i} className="flex gap-3 rounded-xl border border-gray-100 bg-white/80 px-3 py-2.5">
                      <b.icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900">{b.title}</div>
                        <p className="mt-0.5 text-xs leading-snug text-gray-600">{b.desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-auto border-t border-gray-200 pt-4 text-center text-xs text-gray-500">
                  <Link href="#install" className="font-medium text-blue-600 hover:underline">
                    {t('landing', 'boxInstallHint')}
                  </Link>
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ─── Wakugumi / site photography (image + selling points) ─ */}
        <section className="border-b border-gray-200 bg-slate-50 py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-medium tracking-[0.28em] text-gray-400">
              {t('landing', 'showcaseEyebrow')}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
              {t('landing', 'showcaseTitle')}
            </h2>
            <p className="mt-3 max-w-3xl text-gray-600 leading-relaxed">
              {t('landing', 'showcaseSubtitle')}
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-6xl space-y-16 px-4 sm:px-6 lg:px-8 md:space-y-20">
            {/* Row 1 — image left */}
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/5">
                <Image
                  src="/landing/wakugumi-hero-construction.png"
                  alt={t('landing', 'showcase1Alt')}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 sm:text-2xl">
                  {t('landing', 'showcase1Title')}
                </h3>
                <p className="mt-3 text-gray-600 leading-relaxed">{t('landing', 'showcase1Lead')}</p>
                <ul className="mt-5 space-y-2.5 text-sm text-gray-800">
                  {[t('landing', 'showcase1Bullet1'), t('landing', 'showcase1Bullet2'), t('landing', 'showcase1Bullet3')].map(
                    (line) => (
                      <li key={line} className="flex gap-2.5">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                        <span>{line}</span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>

            {/* Row 2 — image right */}
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/5 lg:order-2">
                <Image
                  src="/landing/wakugumi-large-scale.png"
                  alt={t('landing', 'showcase2Alt')}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </div>
              <div className="lg:order-1">
                <h3 className="text-xl font-bold text-gray-900 sm:text-2xl">
                  {t('landing', 'showcase2Title')}
                </h3>
                <p className="mt-3 text-gray-600 leading-relaxed">{t('landing', 'showcase2Lead')}</p>
                <ul className="mt-5 space-y-2.5 text-sm text-gray-800">
                  {[t('landing', 'showcase2Bullet1'), t('landing', 'showcase2Bullet2'), t('landing', 'showcase2Bullet3')].map(
                    (line) => (
                      <li key={line} className="flex gap-2.5">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                        <span>{line}</span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>

            {/* Row 3 — image left */}
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/5">
                <Image
                  src="/landing/wakugumi-facade.png"
                  alt={t('landing', 'showcase3Alt')}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 sm:text-2xl">
                  {t('landing', 'showcase3Title')}
                </h3>
                <p className="mt-3 text-gray-600 leading-relaxed">{t('landing', 'showcase3Lead')}</p>
                <ul className="mt-5 space-y-2.5 text-sm text-gray-800">
                  {[t('landing', 'showcase3Bullet1'), t('landing', 'showcase3Bullet2'), t('landing', 'showcase3Bullet3')].map(
                    (line) => (
                      <li key={line} className="flex gap-2.5">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                        <span>{line}</span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Install CTA (big) ────────────────────────────────── */}
        <section id="install" className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">
              {t('landing', 'sectionInstall')}
            </h2>
            <p className="text-lg text-blue-100 mb-6">
              {t('landing', 'installTitle')}
            </p>
            <p className="text-blue-100/90 text-sm mb-8">
              {t('landing', 'installSubtitle')}
            </p>
            <div className="flex flex-col items-center gap-4">
              {canInstall ? (
                <button
                  onClick={() => triggerInstall()}
                  className="inline-flex items-center gap-3 px-8 py-4 bg-white text-blue-600 rounded-xl font-semibold text-lg hover:bg-blue-50 shadow-lg transition-colors"
                >
                  <Download className="h-6 w-6" />
                  {t('landing', 'installCta')}
                </button>
              ) : (
                <p className="text-sm text-blue-100/90 max-w-md">
                  {t('landing', 'installCtaUnavailable')}
                </p>
              )}
              <p className="text-blue-100/90 text-sm mt-2">
                {t('landing', 'afterInstall')}
              </p>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-lg font-medium text-sm border border-white/30"
                >
                  <LogIn className="h-4 w-4" />
                  {t('landing', 'logIn')}
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-blue-600 hover:bg-blue-50 rounded-lg font-medium text-sm"
                >
                  <UserPlus className="h-4 w-4" />
                  {t('landing', 'register')}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Footer ────────────────────────────────────────────── */}
        <footer className="bg-white border-t border-gray-200 py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
            <p>{t('landing', 'appName')}</p>
            <p className="mt-1">{t('landing', 'tagline')}</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
