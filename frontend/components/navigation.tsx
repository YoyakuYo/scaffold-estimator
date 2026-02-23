'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { usersApi } from '@/lib/api/users';
import { Home, ClipboardList, Calculator, LogOut, Globe, Settings, Brain, Users, User, Shield, MessageSquare } from 'lucide-react';
import { NotificationBell } from '@/components/notification-bell';
import { useI18n, type Locale } from '@/lib/i18n';

export function Navigation() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();

  // Check current user's role to conditionally show Users link
  const { data: currentUser } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const isAdmin = currentUser?.role === 'admin';

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
    ...(isAdmin ? [{ path: '/users', label: locale === 'ja' ? 'ユーザー' : 'Users', icon: Users }] : []),
    { path: '/settings', label: t('nav', 'settings'), icon: Settings },
  ];

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <h1
                className="text-xl font-bold text-gray-900 cursor-pointer"
                onClick={() => router.push('/dashboard')}
                suppressHydrationWarning
              >
                {t('common', 'appName')}
              </h1>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.path ||
                  (item.path !== '/dashboard' && pathname.startsWith(item.path));
                return (
                  <button
                    key={item.path}
                    onClick={() => router.push(item.path)}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      isActive
                        ? 'border-blue-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    <span suppressHydrationWarning>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            {/* Profile Link */}
            <button
              onClick={() => router.push('/profile')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              title={locale === 'ja' ? 'プロフィール' : 'Profile'}
            >
              <User className="h-4 w-4" />
            </button>
            {/* Language Switcher */}
            <button
              onClick={toggleLocale}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors border border-gray-200"
              title={locale === 'ja' ? 'Switch to English' : '日本語に切り替え'}
            >
              <Globe className="h-4 w-4" />
              <span>{locale === 'ja' ? 'EN' : 'JP'}</span>
            </button>
            <button
              onClick={handleLogout}
              className="text-gray-500 hover:text-gray-700 flex items-center space-x-2 px-3 py-2"
            >
              <LogOut className="h-4 w-4" />
              <span suppressHydrationWarning>{t('common', 'logout')}</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
