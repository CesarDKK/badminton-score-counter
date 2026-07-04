/**
 * LiveUpdates - SSE-klient til live game-state opdateringer.
 *
 * Lytter paa /api/game-states/events/stream og kalder onEvent({courtId, type})
 * ved hver aendring. Eventet er kun en "poke" — siden henter selv frisk state
 * bagefter, saa dataformatet er identisk med almindelig polling.
 *
 * onStateChange(connected) kaldes ved aabning/tab af forbindelsen, saa siden
 * kan skrue sin fallback-polling op/ned. EventSource genforbinder selv.
 */
(function () {
    'use strict';

    function connect({ court = null, onEvent, onStateChange } = {}) {
        if (typeof EventSource === 'undefined') {
            // Meget gamle browsere — siden koerer videre paa ren polling
            if (onStateChange) onStateChange(false);
            return { close: function () {} };
        }

        const url = '/api/game-states/events/stream' + (court ? `?court=${encodeURIComponent(court)}` : '');
        let es = null;
        let closed = false;

        function open() {
            if (closed) return;
            es = new EventSource(url);

            es.onopen = () => {
                if (onStateChange) onStateChange(true);
            };

            es.onmessage = (msg) => {
                if (!onEvent) return;
                try {
                    onEvent(JSON.parse(msg.data));
                } catch (e) {
                    console.error('[LiveUpdates] Ugyldigt event:', e);
                }
            };

            es.onerror = () => {
                // EventSource genforbinder selv (retry-intervallet styres af serveren).
                // Meld frakoblet saa siden kan polle hurtigt imens.
                if (onStateChange) onStateChange(false);
            };
        }

        open();

        return {
            close() {
                closed = true;
                if (es) es.close();
            }
        };
    }

    window.LiveUpdates = { connect };
})();
