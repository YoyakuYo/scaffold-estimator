'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { presenceApi } from '@/lib/api/presence';
import { authApi } from '@/lib/api/auth';

export interface PagePresenceState {
  pageKey: string;
  label: string | null;
}

interface PagePresenceContextValue {
  state: PagePresenceState;
  setState: (next: PagePresenceState) => void;
  /**
   * Record a meaningful user action on the current page (uploaded plan.pdf,
   * calculated quantities, exported Excel, etc.). Visible to the superadmin
   * cockpit as `last action`. Always best-effort; never throws.
   */
  recordAction: (action: string, override?: Partial<PagePresenceState>) => void;
}

const PagePresenceContext = createContext<PagePresenceContextValue | null>(null);

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export function PagePresenceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setStateInternal] = useState<PagePresenceState>(() => ({
    pageKey: pathname || 'unknown',
    label: null,
  }));

  // Keep pageKey in sync with pathname when no page explicitly registered yet.
  useEffect(() => {
    setStateInternal((prev) => {
      // Only auto-update pageKey when the page hasn't supplied a custom one.
      if (prev.pageKey === pathname) return prev;
      // If the previous label was set for a different path, drop it.
      return {
        pageKey: pathname || prev.pageKey,
        label: null,
      };
    });
  }, [pathname]);

  const setState = useCallback((next: PagePresenceState) => {
    setStateInternal((prev) => {
      if (prev.pageKey === next.pageKey && prev.label === next.label) return prev;
      return next;
    });
  }, []);

  const recordAction = useCallback(
    (action: string, override?: Partial<PagePresenceState>) => {
      if (!authApi.getToken()) return;
      void presenceApi
        .recordAction({
          action,
          pageKey: override?.pageKey ?? null,
          label: override?.label ?? null,
        })
        .catch(() => {
          /* presence is best-effort */
        });
    },
    [],
  );

  const value = useMemo<PagePresenceContextValue>(
    () => ({ state, setState, recordAction }),
    [state, setState, recordAction],
  );

  return <PagePresenceContext.Provider value={value}>{children}</PagePresenceContext.Provider>;
}

/**
 * Register a stable page key + human-readable label for this page.
 * Sends a presence heartbeat every 30 s while mounted.
 *
 * Pass `null` for `enabled` (or omit `pageKey`) to disable on public pages.
 */
export function usePresence(opts: { pageKey: string; label?: string | null; enabled?: boolean }) {
  const ctx = useContext(PagePresenceContext);
  const { pageKey, label = null, enabled = true } = opts;

  useEffect(() => {
    if (!ctx) return;
    if (!enabled) return;
    ctx.setState({ pageKey, label });
  }, [ctx, pageKey, label, enabled]);
}

/**
 * Mounted once at the app root (inside `LayoutClient`). Heartbeats the
 * current `{pageKey, label}` to the backend every 30 s while the user is
 * authenticated. Disabled on public pages by gating on the JWT cookie.
 */
export function PresenceTracker() {
  const ctx = useContext(PagePresenceContext);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<PagePresenceState>(ctx?.state ?? { pageKey: 'unknown', label: null });

  useEffect(() => {
    stateRef.current = ctx?.state ?? stateRef.current;
  }, [ctx?.state]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!authApi.getToken()) return;

    const tick = () => {
      if (!authApi.getToken()) return;
      void presenceApi
        .update({
          pageKey: stateRef.current.pageKey || null,
          label: stateRef.current.label || null,
        })
        .catch(() => {
          /* best-effort */
        });
    };

    tick();
    intervalRef.current = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}

/**
 * Imperative helper: record an action without needing the hook (e.g. inside
 * mutation onSuccess callbacks). Safe to call when not in a presence-aware tree.
 */
export function usePresenceActions() {
  const ctx = useContext(PagePresenceContext);
  return {
    recordAction: ctx?.recordAction ?? ((_: string) => undefined),
  };
}
