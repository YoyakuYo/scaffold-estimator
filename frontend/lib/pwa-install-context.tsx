'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

type Deferred = ZoomenBeforeInstallPromptEvent;

type PwaInstallContextValue = {
  canInstall: boolean;
  /** Runs the browser install UI when available. Returns true if the native prompt was shown. */
  triggerInstall: () => Promise<boolean>;
};

const PwaInstallContext = createContext<PwaInstallContextValue>({
  canInstall: false,
  triggerInstall: async () => false,
});

function readDeferredFromWindow(): Deferred | null {
  if (typeof window === 'undefined') return null;
  return window.__ZOOMEN_DEFERRED_INSTALL__ ?? null;
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<Deferred | null>(() =>
    typeof window === 'undefined' ? null : readDeferredFromWindow(),
  );

  useEffect(() => {
    const sync = () => {
      setDeferredPrompt(readDeferredFromWindow());
    };
    sync();
    window.addEventListener('zoomen-pwa-install-ready', sync);
    // Fallback if cached HTML omitted the inline bootstrap script
    const fallback = (ev: Event) => {
      ev.preventDefault();
      const e = ev as Deferred;
      window.__ZOOMEN_DEFERRED_INSTALL__ = e;
      setDeferredPrompt(e);
      window.dispatchEvent(new Event('zoomen-pwa-install-ready'));
    };
    window.addEventListener('beforeinstallprompt', fallback);
    return () => {
      window.removeEventListener('zoomen-pwa-install-ready', sync);
      window.removeEventListener('beforeinstallprompt', fallback);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<boolean> => {
    const e = deferredPrompt ?? readDeferredFromWindow();
    if (!e) return false;
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') {
      window.__ZOOMEN_DEFERRED_INSTALL__ = null;
      setDeferredPrompt(null);
    }
    return true;
  }, [deferredPrompt]);

  const canInstall = !!deferredPrompt;

  return (
    <PwaInstallContext.Provider value={{ canInstall, triggerInstall }}>
      {children}
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall() {
  return useContext(PwaInstallContext);
}
