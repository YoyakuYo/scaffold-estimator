'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  Calculator,
  Building2,
  Download,
  CheckCircle,
  Target,
  TrendingUp,
  Users,
  Eye,
  Bot,
  ShieldCheck,
  Receipt,
  Box,
  Globe,
  LogIn,
  UserPlus,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePwaInstall } from '@/lib/pwa-install-context';
import { usersApi } from '@/lib/api/users';
import { authApi } from '@/lib/api/auth';

export default function LandingPage() {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const { canInstall, triggerInstall } = usePwaInstall();

  const hasToken = !!authApi.getToken();

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

  const toggleLocale = () => setLocale(locale === 'ja' ? 'en' : 'ja');

  if (profile) return null;

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
              <button
                onClick={toggleLocale}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
                title={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
              >
                <Globe className="h-4 w-4" />
                <span>{locale === 'ja' ? 'EN' : 'JP'}</span>
              </button>
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
        {/* ─── Hero ─────────────────────────────────────────────── */}
        <section className="bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
            <p className="text-sm font-medium text-slate-300 uppercase tracking-wider mb-3">
              {t('landing', 'forConstruction')}
            </p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 leading-tight">
              {t('landing', 'heroTitle')}
            </h1>
            <p className="text-lg sm:text-xl text-slate-200 max-w-2xl">
              {t('landing', 'heroSubtitle')}
            </p>
            <p className="mt-2 text-slate-400 text-sm max-w-xl">
              {t('landing', 'tagline')}
            </p>
          </div>
        </section>

        {/* ─── Stats (read-only) ─────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: TrendingUp, label: t('features', 'stat1Label'), value: t('features', 'stat1Value'), color: 'text-blue-600' },
              { icon: Target, label: t('features', 'stat2Label'), value: t('features', 'stat2Value'), color: 'text-green-600' },
              { icon: Building2, label: t('features', 'stat3Label'), value: t('features', 'stat3Value'), color: 'text-purple-600' },
              { icon: Download, label: t('features', 'stat4Label'), value: t('features', 'stat4Value'), color: 'text-amber-600' },
            ].map((stat, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                <stat.icon className={`h-7 w-7 ${stat.color} mx-auto mb-2`} />
                <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-sm text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Features (read-only) ──────────────────────────────── */}
        <section className="bg-white border-y border-gray-200 py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              {t('landing', 'sectionFeatures')}
            </h2>
            <p className="text-gray-600 text-center mb-10">
              {t('features', 'coreSubtitle')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              {[
                { icon: Calculator, title: t('features', 'coreCalcTitle'), desc: t('features', 'coreCalcDesc'), bg: 'bg-blue-100', iconColor: 'text-blue-600' },
                { icon: Receipt, title: t('features', 'coreQuotationTitle'), desc: t('features', 'coreQuotationDesc'), bg: 'bg-green-100', iconColor: 'text-green-600' },
                { icon: Box, title: t('features', 'coreVisualizationTitle'), desc: t('features', 'coreVisualizationDesc'), bg: 'bg-purple-100', iconColor: 'text-purple-600' },
              ].map((f, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-6">
                  <div className={`w-11 h-11 rounded-lg ${f.bg} flex items-center justify-center mb-4`}>
                    <f.icon className={`h-6 w-6 ${f.iconColor}`} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-600">{f.desc}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { icon: Eye, title: t('features', 'aiVisionTitle'), desc: t('features', 'aiVisionDesc'), bg: 'bg-purple-100', iconColor: 'text-purple-600' },
                { icon: Bot, title: t('features', 'aiChatTitle'), desc: t('features', 'aiChatDesc'), bg: 'bg-blue-100', iconColor: 'text-blue-600' },
                { icon: ShieldCheck, title: t('features', 'aiAnomalyTitle'), desc: t('features', 'aiAnomalyDesc'), bg: 'bg-green-100', iconColor: 'text-green-600' },
              ].map((f, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-6">
                  <div className={`w-11 h-11 rounded-lg ${f.bg} flex items-center justify-center mb-4`}>
                    <f.icon className={`h-6 w-6 ${f.iconColor}`} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-600">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Why (benefits, read-only) ─────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
            {t('landing', 'sectionWhy')}
          </h2>
          <p className="text-gray-600 text-center mb-10">{t('features', 'benefitsTitle')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: TrendingUp, title: t('features', 'benefit1Title'), desc: t('features', 'benefit1Desc'), bg: 'bg-blue-100', iconColor: 'text-blue-600' },
              { icon: Target, title: t('features', 'benefit2Title'), desc: t('features', 'benefit2Desc'), bg: 'bg-green-100', iconColor: 'text-green-600' },
              { icon: Users, title: t('features', 'benefit3Title'), desc: t('features', 'benefit3Desc'), bg: 'bg-purple-100', iconColor: 'text-purple-600' },
              { icon: CheckCircle, title: t('features', 'benefit4Title'), desc: t('features', 'benefit4Desc'), bg: 'bg-amber-100', iconColor: 'text-amber-600' },
            ].map((b, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-6">
                <div className={`w-10 h-10 rounded-lg ${b.bg} flex items-center justify-center mb-4`}>
                  <b.icon className={`h-5 w-5 ${b.iconColor}`} />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{b.title}</h3>
                <p className="text-sm text-gray-600">{b.desc}</p>
              </div>
            ))}
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
