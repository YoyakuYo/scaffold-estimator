'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { usersApi } from '@/lib/api/users';
import { Home, ClipboardList, Calculator, LogOut, Globe, Settings, Brain, Users, User, Shield, MessageSquare, Building2 } from 'lucide-react';
import { NotificationBell } from '@/components/notification-bell';
import { useI18n, type Locale } from '@/lib/i18n';

export function Navigation() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
    { path: '/ai', label: locale === 'ja' ? 'AI' : 'AI', icon: Brain },
    { path: '/company', label: t('nav', 'company'), icon: Building2 },
    ...(isAdmin ? [{ path: '/users', label: locale === 'ja' ? 'ユーザー' : 'Users', icon: Users }] : []),
    { path: '/settings', label: t('nav', 'settings'), icon: Settings },
  ];

  return (
    <nav className="bg-slate-900 border-b border-slate-700/50 shadow-sm">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-12">
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center mr-6">
              <img src="/icons/icon-32x32.png" alt="" width={22} height={22} className="mr-2.5" />
              <h1
                className="text-sm font-semibold text-white cursor-pointer tracking-wide"
                onClick={() => router.push('/dashboard')}
                suppressHydrationWarning
              >
                {t('common', 'appName')}
              </h1>
            </div>
            <div className="hidden sm:flex sm:items-center sm:space-x-0.5">
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
                  <span>{locale === 'ja' ? 'EN' : 'JP'}</span>
                </button>
                <div className="w-px h-5 bg-slate-700 mx-1" />
                <button
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-red-400 flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>{t('common', 'logout')}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
