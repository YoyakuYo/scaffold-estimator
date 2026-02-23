'use client';

import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePwaInstall } from '@/lib/pwa-install-context';

export function PwaInstallPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const { canInstall, triggerInstall } = usePwaInstall();
  const { locale } = useI18n();

  useEffect(() => {
    const saved = sessionStorage.getItem('pwa-install-dismissed');
    if (saved === 'true') setDismissed(true);
  }, []);

  if (!canInstall || dismissed) return null;

  const handleInstall = async () => {
    await triggerInstall();
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('pwa-install-dismissed', 'true');
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4">
      <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
        <Download className="h-5 w-5 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm">
          {locale === 'ja' ? 'アプリをインストール' : 'Install App'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {locale === 'ja'
            ? 'デスクトップにインストールして素早くアクセス'
            : 'Install to desktop for quick access'}
        </p>
        <button
          onClick={handleInstall}
          className="mt-2 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {locale === 'ja' ? 'インストール' : 'Install'}
        </button>
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
