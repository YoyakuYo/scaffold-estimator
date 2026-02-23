'use client';

import { useEffect, useRef } from 'react';
import { authApi } from '@/lib/api/auth';

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export function Heartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!authApi.getToken()) return;
    const tick = () => {
      authApi.heartbeat().catch(() => {});
    };
    tick();
    intervalRef.current = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return null;
}
