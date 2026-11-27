import React, { useEffect, useState } from 'react';
import { Download, WifiOff } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="px-2.5 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        title="Install Caissa Chess app for offline play & puzzles"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Install</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 p-5 shadow-2xl space-y-3">
              <h3 className="text-base font-bold text-stone-900 dark:text-zinc-100">
                Install Caissa on iPhone / iPad
              </h3>
              <p className="text-xs text-stone-600 dark:text-zinc-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5" />
      <span>Offline Mode — Local Play & Puzzles Ready</span>
    </div>
  );
};
