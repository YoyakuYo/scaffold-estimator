'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, useRef } from 'react';
import {
  Calculator,
  Building2,
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
  Download,
  Mail,
  Loader2,
} from 'lucide-react';
import { useI18n, type Locale } from '@/lib/i18n';
import { usersApi } from '@/lib/api/users';
import { authApi } from '@/lib/api/auth';
import { isAxiosError } from 'axios';
import { submitPublicContact } from '@/lib/api/public-contact';
import { usePwaInstall } from '@/lib/pwa-install-context';

const localeLabels: Record<Locale, string> = { ja: '日本語', en: 'EN', fr: 'FR' };

const LANDING_HERO_3D_SLIDES = [
  '/landing/hero-scaffold-3d.png',
  '/landing/hero-scaffold-3d-b.png',
] as const;

const LANDING_HERO_3D_INTERVAL_MS = 5000;

/** First four marketing stills: pairs for DWG-01 / DWG-02 input panels (crossfade every 5s). */
const LANDING_VALUE_PROP_DWG01_SLIDES = [
  '/landing/value-prop-dwg01-a.png',
  '/landing/value-prop-dwg01-b.png',
] as const;

const LANDING_VALUE_PROP_DWG02_SLIDES = [
  '/landing/value-prop-dwg02-a.png',
  '/landing/value-prop-dwg02-b.png',
] as const;

const LANDING_VALUE_PROP_INTERVAL_MS = 5000;

function LandingValuePropCrossfade({
  slides,
  alt,
  sizes,
  imageClassName,
  priorityFirstSlide,
}: {
  slides: readonly string[];
  alt: string;
  sizes: string;
  imageClassName: string;
  priorityFirstSlide?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [motionOk, setMotionOk] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setMotionOk(!mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!motionOk || slides.length < 2) return;
    const id = window.setInterval(
      () => setActive((i) => (i + 1) % slides.length),
      LANDING_VALUE_PROP_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [motionOk, slides]);

  return (
    <>
      {slides.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt={alt}
          fill
          priority={Boolean(priorityFirstSlide) && i === 0}
          sizes={sizes}
          className={`${imageClassName} transition-opacity duration-1000 ease-in-out motion-reduce:transition-none ${
            i === active ? 'z-[1] opacity-100' : 'z-0 opacity-0'
          }`}
        />
      ))}
      <span className="sr-only" aria-live="polite">
        {active + 1} / {slides.length}
      </span>
    </>
  );
}

function LandingHero3DVisual({
  alt,
  badgeLabel,
  metaLabel,
  rotateHint,
}: {
  alt: string;
  badgeLabel: string;
  metaLabel: string;
  rotateHint: string;
}) {
  const [active, setActive] = useState(0);
  const [motionOk, setMotionOk] = useState(true);
  const sizes = '(max-width: 1024px) 100vw, 58vw';
  const imageClassName = 'object-contain object-center p-3 sm:p-4';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setMotionOk(!mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!motionOk || LANDING_HERO_3D_SLIDES.length < 2) return;
    const id = window.setInterval(
      () => setActive((i) => (i + 1) % LANDING_HERO_3D_SLIDES.length),
      LANDING_HERO_3D_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [motionOk]);

  return (
    <>
      <div className="relative aspect-[4/3] w-full sm:aspect-[5/4] lg:aspect-[16/11] lg:min-h-[min(52vh,440px)]">
        {LANDING_HERO_3D_SLIDES.map((src, i) => (
          <Image
            key={src}
            src={src}
            alt={alt}
            fill
            priority={i === 0}
            sizes={sizes}
            className={`${imageClassName} transition-opacity duration-1000 ease-in-out motion-reduce:transition-none ${
              i === active ? 'z-[1] opacity-100' : 'z-0 opacity-0'
            }`}
          />
        ))}
        <span className="sr-only" aria-live="polite">
          {active + 1} / {LANDING_HERO_3D_SLIDES.length}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-slate-950/90 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90">{badgeLabel}</span>
        <div
          className="flex items-center justify-center gap-1.5"
          aria-hidden
          title={rotateHint}
        >
          {LANDING_HERO_3D_SLIDES.map((src, i) => (
            <span
              key={src}
              className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                i === active ? 'scale-125 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-slate-600'
              }`}
            />
          ))}
        </div>
        <span className="text-[11px] text-slate-400">{metaLabel}</span>
      </div>
    </>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const { triggerInstall } = usePwaInstall();
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactHp, setContactHp] = useState('');
  const [contactFile, setContactFile] = useState<File | null>(null);
  const [contactSent, setContactSent] = useState(false);
  const [contactDelivery, setContactDelivery] = useState<{
    inApp: boolean;
    email: boolean;
  } | null>(null);
  const localeMenuRef = useRef<HTMLDivElement>(null);

  const contactMutation = useMutation({
    mutationFn: () =>
      submitPublicContact({
        name: contactName.trim(),
        email: contactEmail.trim(),
        message: contactMessage.trim(),
        hp: contactHp.trim() || undefined,
        file: contactFile,
      }),
    onSuccess: (data) => {
      setContactSent(true);
      setContactDelivery({
        inApp: data.inAppDelivered,
        email: data.emailSent,
      });
      setContactName('');
      setContactEmail('');
      setContactMessage('');
      setContactHp('');
      setContactFile(null);
    },
  });

  const contactServerError =
    contactMutation.isError && isAxiosError(contactMutation.error)
      ? (contactMutation.error.response?.data as { message?: string } | undefined)?.message
      : undefined;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(display-mode: standalone)');
    const apply = () => {
      const nav = window.navigator as Navigator & { standalone?: boolean };
      setIsStandalone(mq.matches || nav.standalone === true);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
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
              <a
                href="#landing-contact"
                className="hidden md:inline-flex px-2 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              >
                {t('landing', 'contactEyebrow')}
              </a>
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
        {/* ─── Hero: product 3D + 2D elevation (app output) ───── */}
        <section className="relative isolate min-h-[min(92vh,900px)] w-full overflow-hidden bg-gradient-to-br from-slate-950 via-[#0a1628] to-indigo-950 text-white">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            aria-hidden
            style={{
              backgroundImage:
                'radial-gradient(ellipse 80% 55% at 85% 20%, rgba(56,189,248,0.22), transparent 55%), radial-gradient(ellipse 70% 50% at 10% 80%, rgba(99,102,241,0.18), transparent 50%), radial-gradient(ellipse 50% 40% at 50% 100%, rgba(14,165,233,0.12), transparent 45%)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            aria-hidden
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />

          <div className="relative z-10 mx-auto flex min-h-[min(92vh,900px)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:px-8 lg:py-12">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
              <div className="order-2 text-center lg:order-none lg:col-span-5 lg:text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/90">
                  {t('landing', 'forConstruction')}
                </p>
                <h1 className="mt-3 text-2xl font-bold leading-[1.15] tracking-tight sm:text-3xl md:text-4xl lg:text-[2.15rem] lg:leading-[1.12]">
                  <span className="bg-gradient-to-r from-white via-cyan-50 to-sky-200 bg-clip-text text-transparent">
                    {t('landing', 'heroTitle')}
                  </span>
                </h1>
                {t('landing', 'heroSubtitle').trim() ? (
                  <p className="mt-4 max-w-xl text-lg text-slate-200/95 sm:text-xl mx-auto lg:mx-0">
                    {t('landing', 'heroSubtitle')}
                  </p>
                ) : null}
                {t('landing', 'tagline').trim() ? (
                  <p className="mt-2 max-w-lg text-sm text-slate-400 mx-auto lg:mx-0">{t('landing', 'tagline')}</p>
                ) : null}
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                  <Link
                    href="/register"
                    className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-900/40 ring-1 ring-white/20 transition hover:from-sky-400 hover:to-blue-500 hover:shadow-cyan-500/25"
                  >
                    {t('landing', 'heroCtaRegister')}
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/5 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10"
                  >
                    {t('landing', 'logIn')}
                  </Link>
                  {!isStandalone && (
                    <>
                      <span className="inline-flex" title={t('landing', 'installSubtitle')}>
                        <button
                          type="button"
                          onClick={async () => {
                            const prompted = await triggerInstall();
                            if (!prompted) setInstallHelpOpen(true);
                          }}
                          aria-label={t('landing', 'installCta')}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10"
                        >
                          <Download className="h-4 w-4 shrink-0" aria-hidden />
                          {t('landing', 'installCta')}
                        </button>
                      </span>
                      {installHelpOpen && (
                        <div
                          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="install-help-title"
                          onClick={() => setInstallHelpOpen(false)}
                          onKeyDown={(e) => e.key === 'Escape' && setInstallHelpOpen(false)}
                        >
                          <div
                            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-6 text-left text-slate-100 shadow-2xl ring-1 ring-cyan-500/20"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <h2 id="install-help-title" className="text-lg font-semibold text-white">
                              {t('landing', 'installHelpTitle')}
                            </h2>
                            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                              {t('landing', 'installCtaUnavailable')}
                            </p>
                            {typeof navigator !== 'undefined' &&
                              /iPad|iPhone|iPod/.test(navigator.userAgent) && (
                                <p className="mt-3 text-sm text-cyan-200/90 leading-relaxed">
                                  {t('landing', 'iosAddToHome')}
                                </p>
                              )}
                            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                              {t('landing', 'afterInstall')}
                            </p>
                            <button
                              type="button"
                              onClick={() => setInstallHelpOpen(false)}
                              className="mt-6 w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500"
                            >
                              {t('common', 'close')}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <p className="mt-6 text-center text-[11px] leading-snug text-slate-500 lg:text-left">
                  {t('landing', 'heroAppVisualCredit')}
                </p>
                {/* 2D elevation — full width on small screens below CTAs */}
                <div className="mt-8 overflow-hidden rounded-2xl border border-white/15 bg-slate-900/50 shadow-xl ring-1 ring-cyan-500/20 lg:hidden">
                  <div className="relative aspect-[16/10] w-full bg-gradient-to-b from-slate-800/80 to-slate-900">
                    <Image
                      src="/landing/hero-scaffold-2d-elevation.png"
                      alt={t('landing', 'hero2dAlt')}
                      fill
                      className="object-contain object-center p-2"
                      sizes="100vw"
                      priority
                    />
                  </div>
                  <p className="border-t border-white/10 bg-slate-950/80 px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-cyan-200/80">
                    {t('landing', 'hero2dCaption')}
                  </p>
                </div>
              </div>

              <div className="order-1 lg:order-none lg:col-span-7">
                <div className="relative mx-auto w-full max-w-2xl lg:max-w-none">
                  <div
                    className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-cyan-500/25 via-blue-600/20 to-indigo-600/25 blur-2xl lg:-inset-8"
                    aria-hidden
                  />
                  <div className="relative overflow-hidden rounded-3xl border border-cyan-400/35 bg-gradient-to-b from-slate-800/90 to-slate-950 shadow-[0_0_0_1px_rgba(34,211,238,0.12),0_25px_80px_-20px_rgba(0,0,0,0.75),0_0_60px_-30px_rgba(34,211,238,0.35)] ring-1 ring-white/10">
                    <LandingHero3DVisual
                      alt={t('landing', 'hero3dAlt')}
                      badgeLabel={t('landing', 'hero3dBadge')}
                      metaLabel={t('landing', 'hero3dMeta')}
                      rotateHint={t('landing', 'hero3dRotateHint')}
                    />
                  </div>

                  {/* Floating 2D inset — desktop / large tablet */}
                  <div className="pointer-events-none absolute -bottom-2 left-0 z-20 hidden w-[min(100%,340px)] -translate-x-1 translate-y-1/4 lg:block lg:-left-4 lg:bottom-10 lg:translate-x-0 lg:translate-y-0">
                    <div
                      className="pointer-events-auto rotate-[-2deg] overflow-hidden rounded-2xl border border-white/20 bg-slate-900/95 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85)] ring-1 ring-cyan-500/25 transition duration-300 hover:rotate-0 hover:ring-cyan-400/40"
                    >
                      <div className="relative aspect-[4/3] w-full">
                        <Image
                          src="/landing/hero-scaffold-2d-elevation.png"
                          alt={t('landing', 'hero2dAlt')}
                          fill
                          className="object-cover object-top"
                          sizes="340px"
                        />
                      </div>
                      <p className="border-t border-white/10 bg-slate-950 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-cyan-200/90">
                        {t('landing', 'hero2dCaption')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 3-product showcase: Scaffold / BIM / Construction Plan ─ */}
        <section
          className="relative border-b border-slate-800 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 py-16 md:py-20 text-white"
          aria-labelledby="landing-products-heading"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(56,189,248,0.18), transparent 60%), radial-gradient(ellipse 60% 40% at 50% 100%, rgba(139,92,246,0.16), transparent 60%)',
            }}
            aria-hidden
          />
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/90">
                {t('landing', 'productsEyebrow')}
              </p>
              <h2
                id="landing-products-heading"
                className="mt-3 text-3xl md:text-4xl font-bold leading-tight tracking-tight"
              >
                {t('landing', 'productsTitle')}
              </h2>
              <p className="mt-3 text-slate-300">{t('landing', 'productsSubtitle')}</p>
            </div>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
              <LandingProductCard
                tone="cyan"
                title={t('products', 'productScaffold')}
                tagline={t('products', 'productScaffoldTagline')}
                features={[
                  t('landing', 'productScaffoldF1'),
                  t('landing', 'productScaffoldF2'),
                  t('landing', 'productScaffoldF3'),
                ]}
                formats="IFC · DXF · PDF · 画像"
                ctaLabel={t('landing', 'productScaffoldCta')}
                ctaHref="/scaffold"
              />
              <LandingProductCard
                tone="violet"
                title={t('products', 'productBim')}
                tagline={t('products', 'productBimTagline')}
                features={[
                  t('landing', 'productBimF1'),
                  t('landing', 'productBimF2'),
                  t('landing', 'productBimF3'),
                ]}
                formats="IFC · DXF · PDF · DWG"
                ctaLabel={t('landing', 'productBimCta')}
                ctaHref="/bim"
              />
              <LandingProductCard
                tone="amber"
                title={t('products', 'productConstructionPlan')}
                tagline={t('products', 'productConstructionPlanTagline')}
                features={[
                  t('landing', 'productCpF1'),
                  t('landing', 'productCpF2'),
                  t('landing', 'productCpF3'),
                ]}
                formats="PDF · DXF · DWG · 画像 · Excel/CSV"
                ctaLabel={t('landing', 'productCpCta')}
                ctaHref="/construction-plan"
              />
            </div>
          </div>
        </section>

        {/* ─── Value props: stacked high-contrast panels (Input → Features → Why) ─ */}
        <section
          className="relative border-b border-zinc-800/20 bg-[#b8b4ac] py-14 md:py-20"
          aria-labelledby="landing-value-props-heading"
        >
          {/* Site fill + light survey grid (civil / drafting pad) */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.85]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(24,24,27,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,0.06) 1px, transparent 1px), radial-gradient(ellipse 100% 80% at 50% 0%, rgba(255,255,255,0.12), transparent 55%)',
              backgroundSize: '32px 32px, 32px 32px, auto',
            }}
            aria-hidden
          />
          <div className="relative mx-auto max-w-6xl space-y-8 px-4 sm:px-6 lg:space-y-10 lg:px-8">
            <h2 id="landing-value-props-heading" className="sr-only">
              {t('landing', 'appName')} — {t('landing', 'sectionFeatures')}
            </h2>

            {/* Panel 1 — Input: drawing-register / title-block (civil engineering sheet) */}
            <div className="overflow-hidden rounded-sm border-2 border-zinc-800 bg-[#e6e4df] shadow-[6px_6px_0_0_rgba(24,24,27,0.2),0_24px_48px_-12px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between border-b-2 border-zinc-800 bg-zinc-900 px-4 py-2.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="hidden h-px w-8 shrink-0 bg-stone-500 sm:block" aria-hidden />
                  <span className="truncate text-[10px] font-bold uppercase tracking-[0.28em] text-stone-400">
                    {t('landing', 'boxInputEyebrow')}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500" aria-hidden>
                  {t('landing', 'inputSheetRef1')}
                </span>
              </div>
              <div
                className="relative border-l-[3px] border-zinc-800"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(39,39,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(39,39,42,0.04) 1px, transparent 1px)',
                  backgroundSize: '28px 28px',
                }}
              >
                <div className="px-5 py-8 sm:px-7 sm:py-9 md:px-9 md:py-10 lg:px-10 lg:py-11">
                  <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-11 xl:gap-12">
                    <div className="order-2 lg:order-none lg:col-span-5">
                      <figure className="group relative mx-auto max-w-md lg:mx-0">
                        <div className="relative p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] ring-1 ring-zinc-700">
                          <div className="border border-zinc-600 bg-zinc-800">
                            <div className="relative aspect-[4/3] w-full bg-zinc-900">
                              <LandingValuePropCrossfade
                                slides={LANDING_VALUE_PROP_DWG01_SLIDES}
                                alt={t('landing', 'inputWorkstationAlt')}
                                sizes="(max-width: 1024px) 100vw, 42vw"
                                imageClassName="object-cover object-center"
                                priorityFirstSlide
                              />
                              <div
                                className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-zinc-950/40 via-transparent to-zinc-100/10"
                                aria-hidden
                              />
                            </div>
                          </div>
                          <div
                            className="absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-zinc-800 bg-[#e6e4df]"
                            aria-hidden
                          />
                          <div
                            className="absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-zinc-800 bg-[#e6e4df]"
                            aria-hidden
                          />
                        </div>
                        <figcaption className="mt-4 border-t border-zinc-400/80 pt-3 text-sm leading-relaxed text-zinc-700 sm:text-[0.95rem]">
                          {t('landing', 'inputWorkstationCaption')}
                        </figcaption>
                      </figure>
                    </div>

                    <div className="order-1 flex flex-col lg:order-none lg:col-span-7">
                      <h3 className="text-2xl font-bold leading-[1.12] tracking-tight text-zinc-900 sm:text-3xl md:text-[2.1rem] md:leading-[1.08]">
                        {t('landing', 'boxInputTitle')}
                      </h3>
                      <p className="mt-3 text-base font-semibold leading-relaxed text-zinc-800 sm:text-lg">
                        {t('features', 'coreSubtitle')}
                      </p>
                      <p className="mt-3 max-w-xl border-l-2 border-zinc-500 pl-4 text-sm leading-relaxed text-zinc-700 sm:text-[0.95rem]">
                        {t('landing', 'boxInputFormats')}
                      </p>

                      <ul
                        className="mt-8 m-0 flex list-none flex-wrap gap-2.5 overflow-x-auto p-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-3 sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden"
                        aria-label={t('features', 'statsTitle')}
                      >
                        {[
                          { label: t('features', 'stat1Label'), value: t('features', 'stat1Value') },
                          { label: t('features', 'stat2Label'), value: t('features', 'stat2Value') },
                          { label: t('features', 'stat3Label'), value: t('features', 'stat3Value') },
                          { label: t('features', 'stat4Label'), value: t('features', 'stat4Value') },
                        ].map((chip) => (
                          <li
                            key={chip.label}
                            className="min-w-[9.25rem] shrink-0 snap-start border border-zinc-600/80 bg-[#d4d1cb] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:border-zinc-700 sm:min-w-0"
                          >
                            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                              {chip.label}
                            </div>
                            <div className="mt-1 text-base font-bold leading-tight tracking-tight text-zinc-900 sm:text-lg">
                              {chip.value}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Blueprint bridge — matching register sheet */}
            <div className="overflow-hidden rounded-sm border-2 border-zinc-800 bg-[#ddd9d3] shadow-[6px_6px_0_0_rgba(24,24,27,0.2),0_28px_52px_-14px_rgba(0,0,0,0.32)]">
              <div className="flex items-center justify-between border-b-2 border-zinc-800 bg-zinc-900 px-4 py-2.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="hidden h-px w-8 shrink-0 bg-stone-500 sm:block" aria-hidden />
                  <span className="truncate text-[10px] font-bold uppercase tracking-[0.28em] text-stone-400">
                    {t('landing', 'boxInputEyebrow')}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500" aria-hidden>
                  {t('landing', 'inputSheetRef2')}
                </span>
              </div>
              <div className="grid items-stretch lg:grid-cols-2">
                <figure className="relative order-1 min-h-[220px] border-b-2 border-zinc-800 sm:min-h-[280px] lg:order-2 lg:min-h-[min(100%,440px)] lg:border-b-0 lg:border-l-2 lg:border-zinc-800">
                  <div className="absolute inset-0">
                    <LandingValuePropCrossfade
                      slides={LANDING_VALUE_PROP_DWG02_SLIDES}
                      alt={t('landing', 'inputBlueprintAlt')}
                      sizes="(max-width: 1024px) 100vw, 50vw"
                      imageClassName="object-cover object-[center_40%] lg:object-center"
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-zinc-950/25 via-transparent to-zinc-950/15 lg:bg-gradient-to-l lg:from-transparent lg:via-zinc-950/10 lg:to-zinc-950/30"
                    aria-hidden
                  />
                  <figcaption className="sr-only">{t('landing', 'inputBlueprintCaption')}</figcaption>
                </figure>
                <div
                  className="order-2 flex flex-col justify-center border-zinc-800 px-5 py-9 sm:px-8 sm:py-11 lg:order-1 lg:border-r-2 lg:px-10 lg:py-12"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgba(39,39,42,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(39,39,42,0.035) 1px, transparent 1px)',
                    backgroundSize: '28px 28px',
                    backgroundColor: '#e0ddd7',
                  }}
                >
                  <h3 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl md:text-[2.1rem]">
                    {t('landing', 'inputBlueprintTitle')}
                  </h3>
                  <p className="mt-3 max-w-lg border-l-2 border-zinc-500 pl-4 text-base leading-relaxed text-zinc-700 sm:text-lg">
                    {t('landing', 'inputBlueprintLead')}
                  </p>
                  <p className="mt-5 text-sm leading-relaxed text-zinc-600 sm:text-[0.95rem]">
                    {t('landing', 'inputBlueprintCaption')}
                  </p>
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
              </div>
            </div>
          </div>
        </section>

        <section id="landing-contact" className="border-b border-gray-200 bg-white py-14 md:py-16">
          <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-700">{t('landing', 'contactEyebrow')}</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl flex items-center gap-2">
              <Mail className="h-7 w-7 text-blue-600 shrink-0" aria-hidden />
              {t('landing', 'contactTitle')}
            </h2>
            <p className="mt-3 text-gray-600 leading-relaxed">{t('landing', 'contactSubtitle')}</p>

            {contactSent && contactDelivery && (
              <div className="mt-6 space-y-3">
                {contactDelivery.inApp || contactDelivery.email ? (
                  <>
                    <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                      {t('landing', 'contactSuccess')}
                    </p>
                    {contactDelivery.inApp && !contactDelivery.email ? (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        {t('landing', 'contactSuccessEmailNotConfigured')}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">
                    {t('landing', 'contactDeliveryNone')}
                  </p>
                )}
              </div>
            )}

            <form
              className="relative mt-8 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                setContactSent(false);
                setContactDelivery(null);
                contactMutation.mutate();
              }}
            >
              <div>
                <label htmlFor="landing-contact-name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('landing', 'contactName')}
                </label>
                <input
                  id="landing-contact-name"
                  name="name"
                  required
                  maxLength={120}
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  autoComplete="name"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div>
                <label htmlFor="landing-contact-email" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('landing', 'contactEmail')}
                </label>
                <input
                  id="landing-contact-email"
                  name="email"
                  type="email"
                  required
                  maxLength={320}
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div>
                <label htmlFor="landing-contact-message" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('landing', 'contactMessage')}
                </label>
                <textarea
                  id="landing-contact-message"
                  name="message"
                  required
                  minLength={5}
                  maxLength={8000}
                  rows={5}
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div>
                <label htmlFor="landing-contact-file" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('landing', 'contactPlanUpload')}
                </label>
                <input
                  id="landing-contact-file"
                  name="file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.dxf,.dwg,.ifc,application/pdf,image/*"
                  className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-800 hover:file:bg-gray-50"
                  onChange={(e) => setContactFile(e.target.files?.[0] ?? null)}
                />
                <p className="mt-1 text-xs text-gray-500">{t('landing', 'contactPlanUploadHint')}</p>
              </div>
              <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
                <label htmlFor="landing-contact-hp">{t('landing', 'contactHpLabel')}</label>
                <input
                  id="landing-contact-hp"
                  name="hp"
                  tabIndex={-1}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                  value={contactHp}
                  onChange={(e) => setContactHp(e.target.value)}
                />
              </div>
              {contactMutation.isError && (
                <p className="text-sm text-red-600" role="alert">
                  {contactServerError || t('landing', 'contactError')}
                </p>
              )}
              <button
                type="submit"
                disabled={contactMutation.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
              >
                {contactMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {t('landing', 'contactSending')}
                  </>
                ) : (
                  t('landing', 'contactSubmit')
                )}
              </button>
            </form>
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
      </main>
    </div>
  );
}

const PRODUCT_TONES: Record<
  'cyan' | 'violet' | 'amber',
  { ring: string; chip: string; cta: string; ctaHover: string; iconBg: string }
> = {
  cyan: {
    ring: 'ring-cyan-400/30 hover:ring-cyan-300/60',
    chip: 'bg-cyan-500/10 text-cyan-200 border-cyan-400/30',
    cta: 'bg-cyan-500 text-slate-950',
    ctaHover: 'hover:bg-cyan-400',
    iconBg: 'bg-cyan-500/15 text-cyan-200',
  },
  violet: {
    ring: 'ring-violet-400/30 hover:ring-violet-300/60',
    chip: 'bg-violet-500/10 text-violet-200 border-violet-400/30',
    cta: 'bg-violet-500 text-white',
    ctaHover: 'hover:bg-violet-400',
    iconBg: 'bg-violet-500/15 text-violet-200',
  },
  amber: {
    ring: 'ring-amber-400/30 hover:ring-amber-300/60',
    chip: 'bg-amber-500/10 text-amber-200 border-amber-400/30',
    cta: 'bg-amber-500 text-slate-950',
    ctaHover: 'hover:bg-amber-400',
    iconBg: 'bg-amber-500/15 text-amber-200',
  },
};

function LandingProductCard({
  tone,
  title,
  tagline,
  features,
  formats,
  ctaLabel,
  ctaHref,
}: {
  tone: 'cyan' | 'violet' | 'amber';
  title: string;
  tagline: string;
  features: string[];
  formats: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  const tones = PRODUCT_TONES[tone];
  const Icon = tone === 'cyan' ? Calculator : tone === 'violet' ? Box : Ruler;
  return (
    <div
      className={`group relative flex flex-col rounded-2xl border border-white/10 bg-slate-900/70 backdrop-blur-sm p-6 ring-1 transition ${tones.ring}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones.iconBg}`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
      </div>
      <p className="mt-3 text-sm text-slate-300 leading-relaxed">{tagline}</p>
      <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
        {features.map((line) => (
          <li key={line} className="flex gap-2 items-start">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400/80" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <span
          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold border ${tones.chip}`}
        >
          {formats}
        </span>
      </div>
      <Link
        href={ctaHref}
        className={`mt-6 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${tones.cta} ${tones.ctaHover}`}
      >
        {ctaLabel}
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
