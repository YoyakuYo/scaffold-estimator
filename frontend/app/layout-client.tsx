'use client';

import { usePathname } from 'next/navigation';
import { Navigation } from '@/components/navigation';
import { Heartbeat } from '@/components/heartbeat';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNavigation = pathname !== '/login' && pathname !== '/register';

  return (
    <>
      {showNavigation && (
        <>
          <Navigation />
          <Heartbeat />
        </>
      )}
      {children}
    </>
  );
}
