// In-memory event-hub for game-state aendringer — bruges af SSE-endpointet
// i routes/gameStates.js til at pushe "poke"-events til TV/admin/oversigt,
// saa de kan hente frisk state med det samme i stedet for at vente paa naeste poll.
//
// Events er keyet per tenant (clubDbName, eller 'direct' uden multi-tenant)
// saa en klubs opdateringer aldrig naar en anden klubs skaerme.
//
// NB: Kun in-memory — virker fordi appen koerer som een Node-proces.
// Skal backend en dag skaleres til flere processer, skal dette skiftes
// til en delt kanal (fx Redis pub/sub); klienterne falder indtil da blot
// tilbage til polling og mister ikke data.

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
// Hver TV/admin/oversigt-skaerm er en lytter — fjern default-graensen paa 10
emitter.setMaxListeners(0);

function tenantKey(req) {
    return req.clubDbName || 'direct';
}

// type: 'update' (PUT) eller 'reset' (DELETE / Ryd bane)
function publishGameStateChange(req, courtId, type = 'update') {
    emitter.emit(tenantKey(req), { courtId: Number(courtId), type });
}

// Returnerer en unsubscribe-funktion
function subscribeGameStateChanges(req, handler) {
    const key = tenantKey(req);
    emitter.on(key, handler);
    return () => emitter.removeListener(key, handler);
}

module.exports = { publishGameStateChange, subscribeGameStateChanges };
