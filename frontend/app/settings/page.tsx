'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { Calculator, ArrowRight, User } from 'lucide-react';
import { ChangePasswordForm } from '@/components/change-password-form';

/**
 * Account security (change password) plus the former “pricing info” redirect copy.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t('settingsPage', 'title')}</h1>
          <p className="text-gray-500 mt-1">{t('settingsPage', 'subtitle')}</p>
        </div>

        <div className="space-y-6">
          <ChangePasswordForm />

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <User className="h-5 w-5 text-gray-400" />
              {t('settingsPage', 'profileSectionTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-4">{t('settingsPage', 'profileSectionBody')}</p>
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-800"
            >
              {t('settingsPage', 'goToProfile')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <Calculator className="h-5 w-5 text-blue-600" />
              {t('settingsRedirect', 'title')}
            </h2>
            <p className="text-gray-600 text-sm leading-relaxed mb-6">{t('settingsRedirect', 'body')}</p>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
            >
              {t('settingsRedirect', 'cta')}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
