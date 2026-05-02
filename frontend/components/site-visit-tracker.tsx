'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { platformApi } from '@/lib/api/platform';

const VISITOR_KEY = 'zoomen_session_vid';

function getOrCreateVisitorId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let v = window.localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      window.localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return '';
  }
}

/**
 * Records anonymous page views for marketing routes (throttled server-side).
 */
export function SiteVisitTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (last.current === pathname) return;
    last.current = pathname;
    const visitor = getOrCreateVisitorId();
    void platformApi
      .trackPageView({
        path: pathname,
        referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        anonKey: visitor || undefined,
      })
      .catch(() => {});
  }, [pathname]);

  return null;
}
