'use client';

import { usePathname } from 'next/navigation';
import { Navigation } from '@/components/navigation';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNavigation = pathname !== '/login' && pathname !== '/register';

  return (
    <>
      {showNavigation && <Navigation />}
      {children}
    </>
  );
}
