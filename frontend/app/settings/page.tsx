'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { Calculator, ArrowRight } from 'lucide-react';

/**
 * Global “unit price master” was removed. Rental unit prices and fees are entered per job
 * in the quotation wizard after quantity review (scaffold result → Quote wizard).
 */
export default function SettingsPage() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <Calculator className="h-12 w-12 text-blue-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">{t('settingsRedirect', 'title')}</h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">{t('settingsRedirect', 'body')}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          {t('settingsRedirect', 'cta')}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
