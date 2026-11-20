/**
 * Service Worker de SarihBricks 3D — fonctionnement hors ligne.
 *
 * - Stratégie Network-First en ligne (ne gêne jamais `npm run dev` ni les mises à jour),
 *   avec mise en cache automatique de tous les scripts, modules, workers et ressources chargés.
 * - Au premier chargement ou à l'installation, pré-charge également les modules des workers
 *   pour garantir la création et le maillage d'un monde même si l'utilisateur coupe le réseau
 *   dès le menu principal.
 * - Hors ligne : sert toutes les ressources depuis le cache (et `/` en repli de navigation).
 */
const CACHE_NAME = 'sarihbricks-pwa-v1';

function stripViteHmrScript(html) {
  return html.replace(/<script[^>]+src="\/@vite\/client"[^>]*><\/script>/gi, '');
}

function stripViteHmrFromJs(js) {
  return js
    .replace(/import\s+[^;]*from\s*["']\/@vite\/client["'];?/g, 'const __vite_hmr_noop = 0;')
    .replace(/createHotContext\([^)]*\)/g, 'undefined')
    .replace(/__vite__updateStyle\(/g, '(function(id,css){let el=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(!el){el=document.createElement("style");el.setAttribute("data-vite-dev-id",id);document.head.appendChild(el);}el.textContent=css;})(')
    .replace(/__vite__removeStyle\(/g, '(function(){})(');
}

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
            fetch(url, { cache: 'no-cache' }).then(async (res) => {
              if (!res || !res.ok) return;
              if (url === '/' || url === '/index.html') {
                const html = stripViteHmrScript(await res.text());
                return cache.put(url, new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
              }
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
                if (u.pathname === '/@vite/client' || u.pathname === '/@vite/env') return;
                const key = u.pathname + u.search;
                if (visited.has(key)) return;
                visited.add(key);
                const res = await fetch(u.href, { cache: 'no-store' });
                if (!res || !res.ok) return;
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('html') || u.pathname === '/' || u.pathname.endsWith('.html')) {
                  const rawHtml = await res.text();
                  const cleanHtml = stripViteHmrScript(rawHtml);
                  const cleanRes = new Response(cleanHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
                  await cache.put(u.href, cleanRes.clone());
                  if (u.pathname === '/' || u.pathname === '/index.html') {
                    await cache.put('/', cleanRes.clone());
                    await cache.put('/index.html', cleanRes.clone());
                  }
                  let m;
                  const cssRe = /href=["']([^"']+\.css)["']|src=["']([^"']+\.(?:js|ts))["']/g;
                  while ((m = cssRe.exec(cleanHtml)) !== null) {
                    const dep = m[1] || m[2];
                    if (dep && (dep.startsWith('.') || dep.startsWith('/'))) {
                      queue.push(new URL(dep, u.href).href);
                    }
                  }
                  return;
                }
                if (
                  ct.includes('javascript') ||
                  ct.includes('typescript') ||
                  u.pathname.endsWith('.ts') ||
                  u.pathname.endsWith('.js') ||
                  u.pathname.endsWith('.css')
                ) {
                  const text = await res.clone().text();
                  if (text.includes('/@vite/client')) {
                    const cleanJs = stripViteHmrFromJs(text);
                    await cache.put(
                      u.href,
                      new Response(cleanJs, { status: 200, headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }),
                    );
                  } else {
                    await cache.put(u.href, res.clone());
                  }
                  const re = /(?:from|import)\s*['"]([^'"]+)['"]|new\s+URL\(\s*['"]([^'"]+)['"]/g;
                  let m;
                  while ((m = re.exec(text)) !== null) {
                    const dep = m[1] || m[2];
                    if (dep && (dep.startsWith('.') || dep.startsWith('/')) && dep !== '/@vite/client') {
                      const depUrl = new URL(dep, u.href).href;
                      queue.push(depUrl);
                    }
                  }
                  const cssRe = /href=["']([^"']+\.css)["']|src=["']([^"']+\.(?:js|ts))["']/g;
                  while ((m = cssRe.exec(text)) !== null) {
                    const dep = m[1] || m[2];
                    if (dep && (dep.startsWith('.') || dep.startsWith('/'))) {
                      queue.push(new URL(dep, u.href).href);
                    }
                  }
                } else {
                  await cache.put(u.href, res.clone());
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
  // Ne jamais intercepter le canal SSE ni l'API de l'ancien jeu
  if (req.headers.get('accept') === 'text/event-stream') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/@vite/client') {
    event.respondWith(
      new Response(
        'export function createHotContext(){return{accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){}};}\nexport function updateStyle(id,css){let el=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(!el){el=document.createElement("style");el.setAttribute("data-vite-dev-id",id);document.head.appendChild(el);}el.textContent=css;}\nexport function removeStyle(id){const el=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(el)el.remove();}\nexport function injectQuery(u){return u;}\n',
        { status: 200, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } },
      ),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const networkResponse = await fetch(req, { cache: 'no-store' });
        if (networkResponse && networkResponse.status === 200) {
          if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
            const html = stripViteHmrScript(await networkResponse.clone().text());
            const cleanRes = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            cache.put(req, cleanRes.clone()).catch(() => undefined);
            cache.put('/', cleanRes.clone()).catch(() => undefined);
            cache.put('/index.html', cleanRes.clone()).catch(() => undefined);
          } else if (url.pathname.endsWith('.css')) {
            const text = await networkResponse.clone().text();
            if (text.includes('/@vite/client')) {
              const cleanJs = stripViteHmrFromJs(text);
              cache
                .put(req, new Response(cleanJs, { status: 200, headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }))
                .catch(() => undefined);
            } else {
              cache.put(req, networkResponse.clone()).catch(() => undefined);
            }
          } else if (url.pathname !== '/@vite/client') {
            cache.put(req, networkResponse.clone()).catch(() => undefined);
          }
        }
        return networkResponse;
      } catch (err) {
        if (url.pathname === '/@vite/client') {
          return new Response(
            'export function createHotContext(){return{accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){}};}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u;}\n',
            { status: 200, headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' } },
          );
        }
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
