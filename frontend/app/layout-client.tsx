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
import { PresenceTracker } from '@/lib/page-presence-context';
import { SiteVisitTracker } from '@/components/site-visit-tracker';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const noNavPages = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/join-team'];
  const isPublicPage = noNavPages.includes(pathname);
  const isSuperAdminLogin = pathname === '/superadmin';
  /** BIM viewer redirects guests to login; hide chrome briefly before redirect. */
  const isAnonymousBimViewer =
    pathname === '/bim/viewer' && mounted && !authApi.getToken();

  const hasToken = mounted && !!authApi.getToken();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    enabled: hasToken && !isPublicPage && !isSuperAdminLogin,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const isSuperAdmin = profile?.role === 'superadmin';
  const isSuperAdminConsole = pathname.startsWith('/superadmin/console');

  const exitImpersonation = useMutation({
    mutationFn: authApi.exitImpersonation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      router.refresh();
    },
  });

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo(0, 0);
  }, [pathname]);

  const showNav =
    mounted &&
    !isPublicPage &&
    !isSuperAdminLogin &&
    pathname !== '/activate-bank-subscription' &&
    !isAnonymousBimViewer;

  return (
    <>
      <AppTitlebar />
      {mounted && !isSuperAdminLogin && <SiteVisitTracker />}
      <div className="app-main-content">
        {showNav && (
          <>
            {profile?.impersonatedBy && (
              <div className="sticky z-[48] bg-amber-500 text-slate-900 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold shadow-md border-b border-amber-600/80">
                <span>
                  Support session · acting as <span className="font-mono font-bold">{profile.email}</span>
                </span>
                <button
                  type="button"
                  disabled={exitImpersonation.isPending}
                  onClick={() => exitImpersonation.mutate()}
                  className="rounded-md bg-slate-900 text-amber-100 px-3 py-1 text-xs font-semibold hover:bg-slate-800 disabled:opacity-60"
                >
                  Exit impersonation
                </button>
              </div>
            )}
            {!isSuperAdminConsole && (isSuperAdmin ? <SuperAdminNavigation /> : <Navigation />)}
            <Heartbeat />
            <PresenceTracker />
            <PushNotificationSetup enabled={!!profile?.id} />
          </>
        )}
        {children}
      </div>
      <PwaInstallPrompt />
    </>
  );
}
