// Service worker — aktiverer PWA-installation på Android.
//
// Strategi:
//  - API/auth (/api/, /t/): aldrig cache, altid netværk (ingen respondWith).
//  - Fonte + billeder: cache-first (ændrer sig næsten aldrig; sparer requests
//    og virker offline).
//  - Alt andet (HTML/CSS/JS): network-first med cache som offline-fallback.
//
// CACHE_VERSION bumpes ved ændringer i cache-strategien. activate-handleren
// sletter ALLE caches der ikke matcher den aktuelle version, så gamle
// (og forældede) entries ikke hober sig op for evigt.

const CACHE_VERSION = 'v2';
const CACHE_NAME = `badminton-${CACHE_VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        // Ryd gamle caches (fx badminton-v1 og forældede versioner)
        const names = await caches.keys();
        await Promise.all(
            names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
        );
        await clients.claim();
    })());
});

// Er requesten et sjældent-skiftende statisk aktiv (font/billede)?
function isStaticAsset(url) {
    return /\.(woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)(\?|$)/i.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

    // API-kald og adgangslinks — aldrig cache, altid netværk.
    // pathname-tjek (ikke url.includes) så fx "/tournaments/..." ikke fejlmatcher "/t/".
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/t/')) {
        return;
    }

    // Fonte + billeder: cache-first.
    if (isStaticAsset(url)) {
        e.respondWith((async () => {
            const cached = await caches.match(e.request);
            if (cached) return cached;
            try {
                const response = await fetch(e.request);
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                }
                return response;
            } catch {
                // Ingen cache og intet netværk
                return new Response('', { status: 504, statusText: 'Offline' });
            }
        })());
        return;
    }

    // Alt andet (HTML/CSS/JS): netværk først, cache som fallback.
    e.respondWith((async () => {
        try {
            const response = await fetch(e.request);
            if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
            }
            return response;
        } catch {
            const cached = await caches.match(e.request);
            // Aldrig returnere undefined — det giver en kryptisk TypeError.
            return cached || new Response(
                'Offline — siden er ikke tilgængelig uden netværk.',
                { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            );
        }
    })());
});
