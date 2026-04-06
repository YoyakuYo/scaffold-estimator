'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@/lib/api/users';
import { authApi } from '@/lib/api/auth';
import { Navigation } from '@/components/navigation';
import { SuperAdminNavigation } from '@/components/superadmin-navigation';
import { Heartbeat } from '@/components/heartbeat';
import { PwaInstallPrompt } from '@/components/pwa-install-prompt';
import { AppTitlebar } from '@/components/app-titlebar';
import { PushNotificationSetup } from '@/components/push-notification-setup';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const noNavPages = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/join-team'];
  const isPublicPage = noNavPages.includes(pathname);
  const isSuperAdminLogin = pathname === '/superadmin';

  const hasToken = mounted && !!authApi.getToken();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    enabled: hasToken && !isPublicPage && !isSuperAdminLogin,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const isSuperAdmin = profile?.role === 'superadmin';
  const needsBankActivation = !!(profile && profile.role !== 'superadmin' && profile.pendingBankPlan);
  const bankActivationAllowlist = ['/activate-bank-subscription', '/billing', '/profile'];
  const onBankActivationAllowlist =
    bankActivationAllowlist.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!mounted || !hasToken || isPublicPage || isSuperAdminLogin) return;
    if (!needsBankActivation) return;
    if (onBankActivationAllowlist) return;
    router.replace('/activate-bank-subscription');
  }, [mounted, hasToken, isPublicPage, isSuperAdminLogin, needsBankActivation, onBankActivationAllowlist, router]);

  const showNav =
    mounted &&
    !isPublicPage &&
    !isSuperAdminLogin &&
    pathname !== '/activate-bank-subscription';

  return (
    <>
      <AppTitlebar />
      <div className="app-main-content">
        {showNav && (
          <>
            {isSuperAdmin ? <SuperAdminNavigation /> : <Navigation />}
            <Heartbeat />
            <PushNotificationSetup enabled={!!profile?.id} />
          </>
        )}
        {children}
      </div>
      <PwaInstallPrompt />
    </>
  );
}
