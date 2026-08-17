// Caches the WASM Stockfish binary (and its loader script) in the Cache
// Storage API. Plain HTTP caching doesn't stick for the full-net build's
// ~108MB .wasm: verified in a real tab that back-to-back fetch() calls for
// it both report the full transferSize (a genuine re-download), while the
// same test against the ~7MB lite build gets served from the HTTP cache on
// the second call (transferSize 300, a 304). The full build is over
// Chrome's disk-cache per-entry size limit even though the dev/prod servers
// both send a matching ETag; Cache Storage has no such limit.
//
// Matches by filename rather than full path because the path differs
// between the Vite dev server (/@fs/<abs-path>/stockfish-18-single.wasm)
// and the production build (content-hashed, e.g.
// /assets/stockfish-18-single-<hash>.wasm) — the hashed prod filename
// busts this cache automatically on a dependency bump, so only the dev
// path needs the manual CACHE_NAME bump below.
const CACHE_NAME = 'stockfish-engine-v1'; // bump when the `stockfish` npm package version changes

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names.filter((name) => name.startsWith('stockfish-engine-') && name !== CACHE_NAME).map((name) => caches.delete(name))
          )
        )
    ])
  );
});

function isEngineAsset(url) {
  return url.includes('stockfish-18-single') && (url.endsWith('.wasm') || url.endsWith('.js'));
}

self.addEventListener('fetch', (event) => {
  if (!isEngineAsset(event.request.url)) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
  );
});
