import { registerSW } from 'virtual:pwa-register';

/**
 * Registers the service worker (offline app shell). When a new version is ready, `onUpdate`
 * gets a function that activates it and reloads – called only after the user agrees, so that
 * an update never interrupts work in progress.
 */
export function registerAppUpdates(onUpdate: (apply: () => void) => void): void {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    onNeedRefresh: () => onUpdate(() => void update(true)),
  });
}
