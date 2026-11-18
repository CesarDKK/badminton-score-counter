/**
 * LiveUpdates - SSE-klient til live game-state opdateringer.
 *
 * Lytter paa /api/game-states/events/stream og kalder onEvent({courtId, type})
 * ved hver aendring. Eventet er kun en "poke" — siden henter selv frisk state
 * bagefter, saa dataformatet er identisk med almindelig polling.
 *
 * onStateChange(connected) kaldes ved aabning/tab af forbindelsen, saa siden
 * kan skrue sin fallback-polling op/ned.
 *
 * ── Vagthund ──
 * EventSource genforbinder selv, MEN kun naar browseren OPDAGER at forbindelsen
 * er lukket. Paa hal-wifi doer en forbindelse ofte "halvt" (AP-skift, NAT-timeout):
 * TCP-forbindelsen er reelt vaek, men browseren ved det ikke, onerror fyrer aldrig,
 * og skaermen bliver haengende paa sin langsomme sikkerhedspoll uden at faa pushes.
 * Derfor holder vi selv oje med serverens heartbeat: hoerer vi intet i
 * HEARTBEAT_TIMEOUT_MS, lukker vi forbindelsen og genforbinder aktivt.
 *
 * ── Lukket forbindelse (nr. 110) ──
 * Svarer serveren med en fejl i stedet for strømmen (fx 502 fra nginx, mens
 * backenden genstarter), giver browseren op: readyState bliver CLOSED, og der
 * kommer aldrig et nyt forsøg af sig selv. Saa aabner vi selv igen efter 3–7 s,
 * med stigende ventetid op til et loft (15–19 s), indtil det lykkes.
 */
(function () {
    'use strict';

    // Serveren sender 'ping' hvert 25. sekund. 70s ≈ 2,5 missede heartbeats —
    // rigeligt til at et enkelt langsomt netvaerksoejeblik ikke udloeser reconnect.
    const HEARTBEAT_TIMEOUT_MS = 70000;
    const WATCHDOG_TICK_MS = 15000;
    // Ventetid efter en LUKKET forbindelse: 3 s, 6 s, 12 s, derefter 15 s — hver
    // med op til 4 s spredning oveni (altsaa 3–7 s foerst og hoejst 19 s).
    const GENAABN_START_MS = 3000;
    const GENAABN_LOFT_MS = 15000;
    const GENAABN_SPREDNING_MS = 4000;

    // Spredning saa 10 skaerme ikke genforbinder i praecis samme sekund efter et
    // netvaerksudfald (ellers rammer de serveren som en mur samtidig).
    function jitter(baseMs, spreadMs) {
        return baseMs + Math.floor(Math.random() * spreadMs);
    }

    function connect({ court = null, onEvent, onStateChange } = {}) {
        if (typeof EventSource === 'undefined') {
            // Meget gamle browsere — siden koerer videre paa ren polling
            if (onStateChange) onStateChange(false);
            return { close: function () {} };
        }

        const url = '/api/game-states/events/stream' + (court ? `?court=${encodeURIComponent(court)}` : '');
        let es = null;
        let closed = false;
        let lastActivity = Date.now();
        let reconnectTimer = null;
        let lukkedeIRaekke = 0; // lukkede forbindelser siden sidste onopen

        function markAlive() {
            lastActivity = Date.now();
        }

        // Kun én ventende genaabning ad gangen
        function planlaegOpen(ms) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                open();
            }, ms);
        }

        function open() {
            if (closed) return;
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
            // Aldrig to forbindelser paa en gang
            if (es) {
                try { es.close(); } catch (e) { /* ligegyldigt */ }
                es = null;
            }
            markAlive(); // giv forbindelsen et frisk vindue at naa at aabne i

            const kilde = new EventSource(url);
            es = kilde;

            es.onopen = () => {
                markAlive();
                lukkedeIRaekke = 0;
                if (onStateChange) onStateChange(true);
            };

            es.onmessage = (msg) => {
                markAlive();
                if (!onEvent) return;
                try {
                    onEvent(JSON.parse(msg.data));
                } catch (e) {
                    console.error('[LiveUpdates] Ugyldigt event:', e);
                }
            };

            // Serverens heartbeat — eneste formaal er at bevise at forbindelsen lever
            es.addEventListener('ping', markAlive);

            es.onerror = () => {
                if (kilde !== es) return; // en gammel forbindelse, der allerede er erstattet
                // Meld frakoblet saa siden kan polle hurtigt imens.
                if (onStateChange) onStateChange(false);
                // CONNECTING: EventSource genforbinder selv (retry-intervallet
                // styres af serveren) — intet at goere. CLOSED: browseren har
                // givet op, saa vi aabner selv igen.
                if (closed || kilde.readyState !== 2 /* EventSource.CLOSED */) return;
                es = null;
                const ms = Math.min(GENAABN_START_MS * Math.pow(2, lukkedeIRaekke), GENAABN_LOFT_MS);
                lukkedeIRaekke++;
                planlaegOpen(jitter(ms, GENAABN_SPREDNING_MS));
            };
        }

        // Tving en genforbindelse — bruges naar vagthunden ser en tavs forbindelse
        function forceReconnect() {
            if (closed) return;
            console.warn('[LiveUpdates] Ingen heartbeat — genforbinder');
            if (onStateChange) onStateChange(false);
            if (es) {
                try { es.close(); } catch (e) { /* ligegyldigt */ }
                es = null;
            }
            markAlive(); // undgaa at vagthunden fyrer igen med det samme
            planlaegOpen(jitter(500, 1500));
        }

        const watchdog = setInterval(() => {
            if (closed || !es) return;
            if (Date.now() - lastActivity < HEARTBEAT_TIMEOUT_MS) return;
            forceReconnect();
        }, WATCHDOG_TICK_MS);

        // Naar en TV-skaerm/tablet vaekkes igen, er forbindelsen ofte doed uden at
        // browseren har opdaget det — tjek med det samme i stedet for at vente paa
        // naeste vagthunds-tick.
        function onVisible() {
            if (document.visibilityState === 'visible' && !closed) {
                if (Date.now() - lastActivity >= HEARTBEAT_TIMEOUT_MS) forceReconnect();
            }
        }
        document.addEventListener('visibilitychange', onVisible);

        open();

        return {
            close() {
                closed = true;
                clearInterval(watchdog);
                clearTimeout(reconnectTimer);
                document.removeEventListener('visibilitychange', onVisible);
                if (es) es.close();
            }
        };
    }

    window.LiveUpdates = { connect };
})();
