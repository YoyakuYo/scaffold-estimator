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
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/25 transition-colors hover:bg-blue-700"
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

        {/* ─── Value props: stacked high-contrast panels (Input → Features → Why) ─ */}
        <section
          className="relative border-b border-slate-800/10 bg-[#e8eaef] py-14 md:py-20"
          aria-labelledby="landing-value-props-heading"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.55]"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 120% 80% at 100% 0%, rgba(14,165,233,0.16), transparent 50%), radial-gradient(ellipse 100% 60% at 0% 100%, rgba(99,102,241,0.12), transparent 45%)',
            }}
            aria-hidden
          />
          <div className="relative mx-auto max-w-6xl space-y-8 px-4 sm:px-6 lg:space-y-10 lg:px-8">
            <h2 id="landing-value-props-heading" className="sr-only">
              {t('landing', 'appName')} — {t('landing', 'sectionFeatures')}
            </h2>

            {/* Panel 1 — Input (cool gradient, white type) */}
            <div className="overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-cyan-600 via-blue-600 to-indigo-700 p-[1px] shadow-[0_24px_50px_-12px_rgba(37,99,235,0.4)]">
              <div className="rounded-[1.7rem] bg-gradient-to-br from-cyan-700 via-blue-700 to-indigo-800 px-6 py-8 sm:px-10 sm:py-10 md:px-12 md:py-11">
                <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
                  <div className="max-w-2xl">
                    <span className="inline-flex items-center rounded-full bg-white/20 px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white ring-1 ring-white/30">
                      {t('landing', 'boxInputEyebrow')}
                    </span>
                    <h3 className="mt-4 text-2xl font-extrabold leading-[1.15] tracking-tight text-white sm:text-3xl md:text-4xl">
                      {t('landing', 'boxInputTitle')}
                    </h3>
                    <p className="mt-5 text-base font-semibold leading-relaxed text-white sm:text-lg">
                      {t('features', 'coreSubtitle')}
                    </p>
                    <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/90 sm:text-[0.95rem]">
                      {t('landing', 'boxInputFormats')}
                    </p>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-3 sm:max-lg:grid-cols-4 lg:w-[min(100%,380px)] lg:grid-cols-2">
                    {[
                      { label: t('features', 'stat1Label'), value: t('features', 'stat1Value') },
                      { label: t('features', 'stat2Label'), value: t('features', 'stat2Value') },
                      { label: t('features', 'stat3Label'), value: t('features', 'stat3Value') },
                      { label: t('features', 'stat4Label'), value: t('features', 'stat4Value') },
                    ].map((chip) => (
                      <div
                        key={chip.label}
                        className="rounded-2xl bg-white/15 px-4 py-3.5 text-left shadow-inner ring-1 ring-white/25 backdrop-blur-md transition hover:bg-white/20"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-white/75">{chip.label}</div>
                        <div className="mt-1.5 text-base font-bold leading-tight text-white sm:text-lg">{chip.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Panel 2 — Features (dark slate, high-contrast cards) */}
            <div className="overflow-hidden rounded-[1.75rem] bg-slate-950 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.75)] ring-1 ring-white/10">
              <div className="border-b border-white/10 bg-gradient-to-r from-slate-900 to-slate-950 px-6 py-8 sm:px-10 sm:py-9 md:px-12">
                <span className="inline-flex items-center rounded-full bg-cyan-400/15 px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300 ring-1 ring-cyan-400/30">
                  {t('landing', 'boxFeaturesEyebrow')}
                </span>
                <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-white sm:text-3xl md:text-4xl">
                  {t('landing', 'sectionFeatures')}
                </h3>
                <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
                   {t('landing', 'boxFeaturesIntro')}
                </p>
              </div>
              <div className="grid gap-4 bg-slate-950 px-6 pb-8 pt-6 sm:grid-cols-2 sm:px-10 sm:pb-10 sm:pt-8 md:grid-cols-3 md:gap-5 md:px-12 md:pb-12">
                {[
                  { icon: Calculator, title: t('features', 'coreCalcTitle'), desc: t('features', 'coreCalcDesc'), accent: 'from-sky-400 to-blue-500' },
                  { icon: Receipt, title: t('features', 'coreQuotationTitle'), desc: t('features', 'coreQuotationDesc'), accent: 'from-emerald-400 to-teal-500' },
                  { icon: Box, title: t('features', 'coreVisualizationTitle'), desc: t('features', 'coreVisualizationDesc'), accent: 'from-violet-400 to-indigo-500' },
                  { icon: Ruler, title: t('landing', 'quickShapeTitle'), desc: t('landing', 'quickShapeDesc'), accent: 'from-indigo-400 to-blue-500' },
                  { icon: Building2, title: t('landing', 'perSideTitle'), desc: t('landing', 'perSideDesc'), accent: 'from-cyan-400 to-sky-500' },
                  { icon: CheckCircle, title: t('landing', 'deterministicTitle'), desc: t('landing', 'deterministicDesc'), accent: 'from-lime-400 to-emerald-500' },
                ].map((f, i) => (
                  <div
                    key={i}
                    className="group flex gap-4 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-5 shadow-lg transition hover:border-slate-500 hover:bg-slate-800/90 md:flex-col md:gap-4"
                  >
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${f.accent} shadow-md`}
                    >
                      <f.icon className="h-6 w-6 text-white drop-shadow-sm" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-base font-bold leading-snug text-white">{f.title}</h4>
                      <p className="mt-2 text-sm leading-relaxed text-slate-300">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 3 — Why (clean white, bold accents) */}
            <div className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_20px_45px_-15px_rgba(15,23,42,0.12)]">
              <div className="border-l-[6px] border-blue-600 bg-gradient-to-r from-sky-50/70 to-transparent px-6 py-8 sm:px-10 md:px-12 md:py-10">
                <span className="inline-flex items-center rounded-full bg-blue-600/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-800 ring-1 ring-blue-600/25">
                  {t('landing', 'boxWhyEyebrow')}
                </span>
                <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                  {t('landing', 'sectionWhy')}
                </h3>
                <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">{t('landing', 'boxWhyIntro')}</p>
                <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
                  {[
                    { icon: TrendingUp, title: t('features', 'benefit1Title'), desc: t('features', 'benefit1Desc'), ring: 'ring-blue-500/15', iconBg: 'bg-blue-600 text-white' },
                    { icon: Target, title: t('features', 'benefit2Title'), desc: t('features', 'benefit2Desc'), ring: 'ring-sky-500/15', iconBg: 'bg-sky-600 text-white' },
                    { icon: Users, title: t('features', 'benefit3Title'), desc: t('features', 'benefit3Desc'), ring: 'ring-violet-500/15', iconBg: 'bg-violet-600 text-white' },
                    { icon: CheckCircle, title: t('features', 'benefit4Title'), desc: t('features', 'benefit4Desc'), ring: 'ring-emerald-500/15', iconBg: 'bg-emerald-600 text-white' },
                  ].map((b, i) => (
                    <li
                      key={i}
                      className={`flex gap-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-5 ring-1 ${b.ring}`}
                    >
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${b.iconBg} shadow-sm`}>
                        <b.icon className="h-5 w-5" aria-hidden strokeWidth={2.25} />
                      </span>
                      <div className="min-w-0">
                        <span className="text-base font-bold leading-snug text-slate-900">{b.title}</span>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">{b.desc}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-8 text-center text-sm font-semibold text-slate-600">
                  <Link href="#install" className="text-blue-600 underline decoration-sky-300 decoration-2 underline-offset-4 transition hover:text-blue-800">
                    {t('landing', 'boxInstallHint')}
                  </Link>
                </p>
              </div>
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
