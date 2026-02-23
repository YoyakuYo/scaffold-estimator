'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Shield, Users, MessageSquare, User, LogOut, CreditCard } from 'lucide-react';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';

export function SuperAdminNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useI18n();

  const t = (en: string, ja: string) => (locale === 'ja' ? ja : en);

  const navItems = [
    { path: '/superadmin/dashboard', matchAlso: ['/dashboard'], label: t('Dashboard', 'ダッシュボード'), icon: Shield },
    { path: '/users', matchAlso: [] as string[], label: t('Users', 'ユーザー'), icon: Users },
    { path: '/superadmin/subscribers', matchAlso: [] as string[], label: t('Subscribers', '購読者'), icon: CreditCard },
    { path: '/admin/messages', matchAlso: [] as string[], label: t('Messages', 'メッセージ'), icon: MessageSquare },
    { path: '/profile', matchAlso: [] as string[], label: t('Profile', 'プロフィール'), icon: User },
  ];

  return (
    <nav className="bg-slate-950 border-b border-slate-800">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-amber-500/20">
            <Shield className="h-4 w-4 text-amber-400" />
          </span>
          <button
            onClick={() => router.push('/superadmin/dashboard')}
            className="text-sm font-semibold text-white"
          >
            {t('Super Admin Console', 'スーパー管理者コンソール')}
          </button>
          <div className="hidden sm:flex items-center gap-1 ml-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.path
                || pathname.startsWith(`${item.path}/`)
                || item.matchAlso.some((p) => pathname === p || pathname.startsWith(`${p}/`));
              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    active ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={() => authApi.logout()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-red-300 hover:bg-slate-800 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>{t('Logout', 'ログアウト')}</span>
        </button>
      </div>
    </nav>
  );
}
