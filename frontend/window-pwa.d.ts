/** Captured early in root layout so React never misses `beforeinstallprompt`. */
interface ZoomenBeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface Window {
  __ZOOMEN_DEFERRED_INSTALL__?: ZoomenBeforeInstallPromptEvent | null;
}
