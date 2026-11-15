/**
 * Registers the generated service worker (see vite-plugins.ts) so the app can start
 * without a network once it has been opened. Service workers need a secure context, so
 * this does nothing over plain HTTP from another device on the local network.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => undefined);
  });
}
