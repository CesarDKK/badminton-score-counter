// Syntetisk TP-model til tests (ingen persondata).
// raekker: [{ id, aargang, raekke, kategorier: [{ kat, type, spillere: [[id, …], …] }] }]
export function model(raekker, dage = ['2026-11-21']) {
    const spillere = {}, kategorier = [], tilmeldinger = {};
    let ev = 0;
    const sp = (id) => { spillere[id] = spillere[id] || { id, fornavn: id, efternavn: 'X', koen: 'H', foedt: null, klub: 'K', memberid: null, niveau: {}, point: {} }; return id; };
    for (const r of raekker) for (const k of r.kategorier) {
        const id = `${r.id} ${k.kat}`;
        ev += 1;
        kategorier.push({ id, eventId: ev, raekke: r.id, aargang: r.aargang, kat: k.kat, type: k.type, mix: false, form: 'ingen lodtrækning', tilmeldte: 0, kampe: 0, runder: 0, halvBane: false });
        tilmeldinger[id] = k.spillere.map((ids, i) => ({ entry: ev * 100 + i, spillere: ids.map(sp) }));
    }
    return {
        version: 1, kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null }, turnering: { navn: 'T', hal: '', dage },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 4, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: raekker.map((r) => ({ id: r.id, aargang: r.aargang, raekke: r.raekke, pauseKlasse: r.raekke === 'E' ? 'E' : r.raekke === 'M' ? 'M' : 'ABCD', kategorier: r.kategorier.map((k) => `${r.id} ${k.kat}`) })),
        kategorier, spillere, kampe: [], tilmeldinger, bemaerkninger: [],
    };
}
