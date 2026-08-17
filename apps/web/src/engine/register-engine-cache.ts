/** Registers the service worker (public/engine-sw.js) that caches the WASM
 * Stockfish binary in the Cache Storage API — see that file for why plain
 * HTTP caching isn't enough. Best-effort: browsers without service worker
 * support, or a registration failure, just fall back to re-downloading the
 * engine on every worker start. */
export function registerEngineCache(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/engine-sw.js').catch(() => {});
}
