'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { usersApi } from '@/lib/api/users';
import { Home, ClipboardList, Calculator, LogOut, Globe, Settings, Users, User, MessageSquare, CreditCard, Menu, X } from 'lucide-react';
import { NotificationBell } from '@/components/notification-bell';
import { useI18n, type Locale } from '@/lib/i18n';

export function Navigation() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMobileOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check current user's role to conditionally show Users link
  const { data: currentUser } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const isAdmin = currentUser?.role === 'superadmin';

  const handleLogout = () => {
    authApi.logout();
  };

  const toggleLocale = () => {
    setLocale(locale === 'ja' ? 'en' : 'ja');
  };

  const navItems = [
    { path: '/dashboard', label: t('nav', 'dashboard'), icon: Home },
    { path: '/scaffold', label: t('nav', 'scaffold'), icon: Calculator },
    { path: '/quotations', label: t('nav', 'quotations'), icon: ClipboardList },
    { path: '/billing', label: locale === 'ja' ? '請求' : 'Billing', icon: CreditCard },
    { path: '/support', label: locale === 'ja' ? 'サポート' : 'Support', icon: MessageSquare },
    ...(isAdmin ? [{ path: '/users', label: locale === 'ja' ? 'ユーザー' : 'Users', icon: Users }] : []),
    { path: '/settings', label: t('nav', 'settings'), icon: Settings },
  ];

  return (
    <nav className="bg-slate-900 border-b border-slate-700/50 shadow-sm" ref={menuRef}>
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-12">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="md:hidden p-2 rounded text-slate-300 hover:text-white hover:bg-slate-800"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex-shrink-0 flex items-center mr-2 md:mr-6">
              <img src="/icons/icon-32x32.png" alt="" width={22} height={22} className="mr-2.5" />
              <h1
                className="text-sm font-semibold text-white cursor-pointer tracking-wide"
                onClick={() => router.push('/dashboard')}
                suppressHydrationWarning
              >
                {t('common', 'appName')}
              </h1>
            </div>
            <div className="hidden md:flex md:items-center md:space-x-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.path ||
                  (item.path !== '/dashboard' && pathname.startsWith(item.path));
                return (
                  <button
                    key={item.path}
                    onClick={() => router.push(item.path)}
                    className={`inline-flex items-center px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 mr-1.5" />
                    <span suppressHydrationWarning>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {mounted && (
              <>
                <NotificationBell />
                <button
                  onClick={() => router.push('/profile')}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                  title={locale === 'ja' ? 'プロフィール' : 'Profile'}
                >
                  <User className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={toggleLocale}
                  className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                  title={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{locale === 'ja' ? 'EN' : 'JP'}</span>
                </button>
                <div className="w-px h-5 bg-slate-700 mx-1 hidden sm:block" />
                <button
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-red-400 flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('common', 'logout')}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden absolute left-0 right-0 top-12 z-50 bg-slate-900 border-b border-slate-700 shadow-lg">
          <div className="px-3 py-3 space-y-0.5 max-h-[70vh] overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.path ||
                (item.path !== '/dashboard' && pathname.startsWith(item.path));
              return (
                <button
                  key={item.path}
                  onClick={() => { router.push(item.path); setMobileOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
