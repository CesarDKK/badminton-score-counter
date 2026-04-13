// Service worker — aktiverer PWA-installation på Android
// Bruger network-first så app'en altid henter friske data fra serveren

const CACHE_NAME = 'badminton-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('fetch', (e) => {
    // API-kald og auth — aldrig cache, altid netværk
    if (e.request.url.includes('/api/') || e.request.url.includes('/t/')) {
        return;
    }

    // Alt andet: netværk først, cache som fallback
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // Gem en kopi i cache
                if (response.ok && e.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(e.request))
    );
});
