'use client';

import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@/lib/api/users';
import { authApi } from '@/lib/api/auth';
import { Navigation } from '@/components/navigation';
import { SuperAdminNavigation } from '@/components/superadmin-navigation';
import { Heartbeat } from '@/components/heartbeat';
import { PwaInstallPrompt } from '@/components/pwa-install-prompt';
import { AppTitlebar } from '@/components/app-titlebar';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noNavPages = ['/', '/login', '/register'];
  const isPublicPage = noNavPages.includes(pathname);
  const isSuperAdminLogin = pathname === '/superadmin';

  const hasToken = !!authApi.getToken();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    enabled: hasToken && !isPublicPage && !isSuperAdminLogin,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const isSuperAdmin = profile?.role === 'superadmin';
  const showNav = !isPublicPage && !isSuperAdminLogin;

  return (
    <>
      <AppTitlebar />
      <div className="app-main-content">
        {showNav && (
          <>
            {isSuperAdmin ? <SuperAdminNavigation /> : <Navigation />}
            <Heartbeat />
          </>
        )}
        {children}
      </div>
      <PwaInstallPrompt />
    </>
  );
}
