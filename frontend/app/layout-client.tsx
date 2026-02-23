'use client';

import { usePathname } from 'next/navigation';
import { Navigation } from '@/components/navigation';
import { Heartbeat } from '@/components/heartbeat';
import { PwaInstallPrompt } from '@/components/pwa-install-prompt';
import { AppTitlebar } from '@/components/app-titlebar';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noNavPages = ['/', '/login', '/register'];
  const isSuperAdminArea = pathname.startsWith('/superadmin');
  const showNavigation = !noNavPages.includes(pathname) && !isSuperAdminArea;

  return (
    <>
      <AppTitlebar />
      <div className="app-main-content">
        {showNavigation && (
          <>
            <Navigation />
            <Heartbeat />
          </>
        )}
        {children}
      </div>
      <PwaInstallPrompt />
    </>
  );
}
