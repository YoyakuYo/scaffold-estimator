'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Shield, Users, MessageSquare, User, LogOut, CreditCard, Globe, Menu, X } from 'lucide-react';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';
import { NotificationBell } from '@/components/notification-bell';

export function SuperAdminNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const localeMenuRef = useRef<HTMLDivElement>(null);
  const localeLabels = { ja: '日本語', en: 'EN', fr: 'FR' } as const;

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) setMobileOpen(false);
      if (localeMenuRef.current && !localeMenuRef.current.contains(target)) setLocaleMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems = [
    { path: '/superadmin/console', matchAlso: ['/superadmin/dashboard', '/dashboard'], label: t('superadminNav', 'dashboard'), icon: Shield },
    { path: '/users', matchAlso: [] as string[], label: t('superadminNav', 'users'), icon: Users },
    { path: '/superadmin/subscribers', matchAlso: [] as string[], label: t('superadminNav', 'subscribers'), icon: CreditCard },
    { path: '/admin/messages', matchAlso: [] as string[], label: t('superadminNav', 'messages'), icon: MessageSquare },
    { path: '/profile', matchAlso: [] as string[], label: t('superadminNav', 'profile'), icon: User },
  ];

  return (
    <nav
      className="sticky z-50 bg-slate-950 border-b border-slate-800 relative [top:env(titlebar-area-height,0px)]"
      ref={menuRef}
    >
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
            onClick={() => router.push('/superadmin/console')}
            className="text-sm font-semibold text-white"
          >
            {t('superadminNav', 'consoleTitle')}
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
          <NotificationBell />
          <div className="relative" ref={localeMenuRef}>
            <button
              type="button"
              onClick={() => setLocaleMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              title={t('common', 'language')}
              aria-expanded={localeMenuOpen}
              aria-haspopup="true"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{localeLabels[locale]}</span>
            </button>
            {localeMenuOpen && (
              <div className="absolute right-0 top-full mt-1 py-1 w-28 rounded-md bg-slate-800 border border-slate-700 shadow-lg z-50">
                {(['ja', 'en', 'fr'] as const).map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => { setLocale(loc); setLocaleMenuOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium transition-colors ${locale === loc ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                  >
                    {localeLabels[loc]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-5 bg-slate-700 mx-0.5" />
          <button
            onClick={() => authApi.logout()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-red-300 hover:bg-slate-800 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('common', 'logout')}</span>
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
