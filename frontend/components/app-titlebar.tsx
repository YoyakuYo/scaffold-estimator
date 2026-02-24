'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

export function AppTitlebar() {
  const [isWco, setIsWco] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: window-controls-overlay)');
    setIsWco(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsWco(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!isWco) return null;

  return (
    <div className="app-titlebar">
      <img
        src="/icons/icon-32x32.png"
        alt=""
        width={20}
        height={20}
        className="app-titlebar-nodrag mr-2"
        style={{ imageRendering: 'auto' }}
      />
      <span className="text-sm font-medium tracking-wide opacity-90">
        仮設材積算システム
      </span>
    </div>
  );
}
