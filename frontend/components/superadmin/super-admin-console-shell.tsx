'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  SlidersHorizontal,
  Shield,
  Users,
  CreditCard,
  MessageSquare,
  User,
  ListChecks,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { authApi } from '@/lib/api/auth';

const nav = [
  { href: '/superadmin/console', labelKey: ['superadminConsole', 'overview'] as const, icon: LayoutDashboard, exact: true },
  { href: '/superadmin/console/analytics', labelKey: ['superadminConsole', 'analytics'] as const, icon: BarChart3 },
  { href: '/superadmin/console/pending', labelKey: ['superadminConsole', 'pending'] as const, icon: ListChecks },
  { href: '/superadmin/console/users', labelKey: ['superadminNav', 'users'] as const, icon: Users },
  { href: '/superadmin/console/subscribers', labelKey: ['superadminNav', 'subscribers'] as const, icon: CreditCard },
  { href: '/superadmin/console/platform', labelKey: ['superadminConsole', 'platform'] as const, icon: SlidersHorizontal },
  { href: '/superadmin/console/security', labelKey: ['superadminConsole', 'security'] as const, icon: Shield },
  { href: '/superadmin/console/messages', labelKey: ['superadminNav', 'messages'] as const, icon: MessageSquare },
  { href: '/superadmin/console/profile', labelKey: ['superadminNav', 'profile'] as const, icon: User },
] as const;

export function SuperAdminConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const isActive = useCallback(
    (href: string, exact?: boolean) => {
      if (exact) return pathname === href || pathname === `${href}/`;
      return pathname === href || pathname.startsWith(`${href}/`);
    },
    [pathname],
  );

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-[calc(100dvh-env(titlebar-area-height,0px))] flex bg-slate-950 text-slate-100">
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-slate-800 bg-slate-950/95 backdrop-blur-xl">
        <div className="p-5 border-b border-slate-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('superadminConsole', 'suiteLabel')}</p>
          <p className="text-lg font-bold text-white mt-1 tracking-tight">{t('superadminConsole', 'suiteTitle')}</p>
          <p className="text-xs text-slate-500 mt-1">{t('superadminConsole', 'suiteSubtitle')}</p>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = 'exact' in item ? isActive(item.href, true) : isActive(item.href);
            const label = (t as (s: string, k: string) => string)(item.labelKey[0], item.labelKey[1]);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-800 mt-auto">
          <button
            type="button"
            onClick={() => authApi.logout()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:bg-slate-900 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            {t('common', 'logout')}
          </button>
        </div>
      </aside>

      <div className="lg:hidden fixed top-[calc(env(titlebar-area-height,0px)+0.75rem)] left-4 z-[60]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-slate-900 border border-slate-700 p-2 text-slate-200 shadow-xl"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 bg-black/60 z-[55]" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute left-0 top-12 w-[min(100vw-2rem,20rem)] rounded-xl border border-slate-800 bg-slate-950 shadow-2xl p-3 z-[60] space-y-0.5 max-h-[70vh] overflow-y-auto">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = 'exact' in item ? isActive(item.href, true) : isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${active ? 'bg-amber-600 text-white' : 'text-slate-300'}`}
                    onClick={() => setOpen(false)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {(t as (s: string, k: string) => string)(item.labelKey[0], item.labelKey[1])}
                  </Link>
                );
              })}
              <button
                type="button"
                className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-300"
                onClick={() => authApi.logout()}
              >
                <LogOut className="h-4 w-4" />
                {t('common', 'logout')}
              </button>
            </div>
          </>
        )}
      </div>

      <main className="flex-1 min-w-0 overflow-x-auto">
        <div className="sticky top-[env(titlebar-area-height,0px)] z-40 lg:hidden h-px bg-transparent" />
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
