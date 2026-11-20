/**
 * Service Worker de SarihBricks 3D — fonctionnement hors ligne (production uniquement).
 *
 * - Stratégie Network-First en ligne, avec mise en cache automatique des scripts,
 *   modules, workers et ressources chargés.
 * - Au premier chargement ou à l'installation, pré-charge également les modules des workers
 *   pour garantir la création et le maillage d'un monde même hors ligne.
 * - Hors ligne : sert toutes les ressources depuis le cache (et `/` en repli de navigation).
 */
const CACHE_NAME = 'sarihbricks-pwa-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            fetch(url, { cache: 'no-cache' }).then((res) => {
              if (!res || !res.ok) return;
              return cache.put(url, res);
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'WARM_CACHE' && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        const visited = new Set();
        const queue = [...data.urls];
        while (queue.length > 0) {
          const batch = queue.splice(0, 8);
          await Promise.allSettled(
            batch.map(async (rawUrl) => {
              try {
                const u = new URL(rawUrl, self.location.origin);
                if (u.origin !== self.location.origin) return;
                const key = u.pathname + u.search;
                if (visited.has(key)) return;
                visited.add(key);
                const res = await fetch(u.href, { cache: 'no-store' });
                if (!res || !res.ok) return;
                const ct = res.headers.get('content-type') || '';
                await cache.put(u.href, res.clone());
                if (u.pathname === '/' || u.pathname === '/index.html') {
                  await cache.put('/', res.clone());
                  await cache.put('/index.html', res.clone());
                }
                if (ct.includes('html') || u.pathname === '/' || u.pathname.endsWith('.html')) {
                  const text = await res.text();
                  let m;
                  const cssRe = /href=["']([^"']+\.css)["']|src=["']([^"']+\.(?:js|ts))["']/g;
                  while ((m = cssRe.exec(text)) !== null) {
                    const dep = m[1] || m[2];
                    if (dep && (dep.startsWith('.') || dep.startsWith('/'))) {
                      queue.push(new URL(dep, u.href).href);
                    }
                  }
                } else if (
                  ct.includes('javascript') ||
                  u.pathname.endsWith('.js') ||
                  u.pathname.endsWith('.css')
                ) {
                  const text = await res.text();
                  const re = /(?:from|import)\s*['"]([^'"]+)['"]|new\s+URL\(\s*['"]([^'"]+)['"]/g;
                  let m;
                  while ((m = re.exec(text)) !== null) {
                    const dep = m[1] || m[2];
                    if (dep && (dep.startsWith('.') || dep.startsWith('/'))) {
                      queue.push(new URL(dep, u.href).href);
                    }
                  }
                }
              } catch {
                // ignore
              }
            }),
          );
        }
      }),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.get('accept') === 'text/event-stream') return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const networkResponse = await fetch(req, { cache: 'no-store' });
        if (networkResponse && networkResponse.status === 200) {
          cache.put(req, networkResponse.clone()).catch(() => undefined);
          if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
            cache.put('/', networkResponse.clone()).catch(() => undefined);
            cache.put('/index.html', networkResponse.clone()).catch(() => undefined);
          }
        }
        return networkResponse;
      } catch (err) {
        const cached =
          (await cache.match(req)) ||
          (await cache.match(url.pathname + url.search)) ||
          (await cache.match(url.pathname));
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const fallback = (await cache.match('/')) || (await cache.match('/index.html'));
          if (fallback) return fallback;
        }
        throw err;
      }
    })(),
  );
});
