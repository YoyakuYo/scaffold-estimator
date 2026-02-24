'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Shield, Users, MessageSquare, User, LogOut, CreditCard, Globe, Menu, X } from 'lucide-react';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';

export function SuperAdminNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const t = (en: string, ja: string) => (locale === 'ja' ? ja : en);
  const toggleLocale = () => setLocale(locale === 'ja' ? 'en' : 'ja');

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMobileOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems = [
    { path: '/superadmin/dashboard', matchAlso: ['/dashboard'], label: t('Dashboard', 'ダッシュボード'), icon: Shield },
    { path: '/users', matchAlso: [] as string[], label: t('Users', 'ユーザー'), icon: Users },
    { path: '/superadmin/subscribers', matchAlso: [] as string[], label: t('Subscribers', '購読者'), icon: CreditCard },
    { path: '/admin/messages', matchAlso: [] as string[], label: t('Messages', 'メッセージ'), icon: MessageSquare },
    { path: '/profile', matchAlso: [] as string[], label: t('Profile', 'プロフィール'), icon: User },
  ];

  return (
    <nav className="bg-slate-950 border-b border-slate-800 relative" ref={menuRef}>
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="md:hidden p-2 rounded text-slate-300 hover:text-white hover:bg-slate-800"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-amber-500/20 flex-shrink-0">
            <Shield className="h-4 w-4 text-amber-400" />
          </span>
          <button
            onClick={() => router.push('/superadmin/dashboard')}
            className="text-sm font-semibold text-white"
          >
            {t('Super Admin Console', 'スーパー管理者コンソール')}
          </button>
          <div className="hidden md:flex items-center gap-1 ml-4">
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
        <div className="flex items-center gap-1">
          <button
            onClick={toggleLocale}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            title={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
          >
            <Globe className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{locale === 'ja' ? 'EN' : 'JP'}</span>
          </button>
          <div className="w-px h-5 bg-slate-700 mx-0.5" />
          <button
            onClick={() => authApi.logout()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-red-300 hover:bg-slate-800 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('Logout', 'ログアウト')}</span>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden absolute left-0 right-0 top-12 z-50 bg-slate-950 border-b border-slate-800 shadow-lg">
          <div className="px-3 py-3 space-y-0.5 max-h-[70vh] overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.path
                || pathname.startsWith(`${item.path}/`)
                || item.matchAlso.some((p) => pathname === p || pathname.startsWith(`${p}/`));
              return (
                <button
                  key={item.path}
                  onClick={() => { router.push(item.path); setMobileOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
