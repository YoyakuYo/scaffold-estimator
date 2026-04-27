'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ArrowRight, Lock, Box, Upload, Info } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePresence } from '@/lib/page-presence-context';
import { accessApi } from '@/lib/api/access';

export default function BimHomePage() {
  const { t } = useI18n();
  usePresence({ pageKey: 'bim/home', label: 'BIM Viewer: home' });

  const { data: access, isLoading } = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  const enabled = !!access?.bim?.hasAccess;
  if (!enabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 mb-4">
              <Lock className="h-7 w-7 text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              {t('bimLanding', 'lockedTitle')}
            </h1>
            <p className="mt-2 text-gray-600">{t('bimLanding', 'lockedBody')}</p>
            <Link
              href="/billing#bim"
              className="mt-6 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              {t('products', 'subscribeCta')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Box className="h-7 w-7 text-violet-600" />
            {t('bimLanding', 'title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('bimLanding', 'subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Upload className="h-5 w-5 text-violet-500" />
              {t('bimLanding', 'openViewerTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-4">{t('bimLanding', 'openViewerBody')}</p>
            <Link
              href="/bim/viewer"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 font-medium"
            >
              {t('bimLanding', 'openViewerCta')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="bg-violet-50/60 border border-violet-200 rounded-xl p-4 text-sm text-violet-900 flex gap-3">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>{t('bimLanding', 'privacyNote')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
