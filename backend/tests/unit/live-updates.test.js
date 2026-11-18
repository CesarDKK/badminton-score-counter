/**
 * Nr. 110: når backenden genstarter, svarer nginx 502 på SSE-strømmen, og
 * browseren lukker EventSource for altid (readyState CLOSED). Skærmene sad så
 * på deres langsomme sikkerhedspoll, indtil vagthunden (70 s) eller en
 * genindlæsning reddede dem. Nu åbner live-updates.js selv igen efter 3–7 s,
 * med stigende ventetid op til et loft.
 *
 * frontend/js/live-updates.js køres her i en sandkasse med en falsk
 * EventSource og et falsk ur (setTimeout/setInterval/Date.now).
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROD = path.join(__dirname, '..', '..', '..');
const KILDE = fs.readFileSync(path.join(ROD, 'frontend/js/live-updates.js'), 'utf8');

// Et falsk ur: timere kører kun, når testen skruer tiden frem
function lavUr() {
    let nu = 1_000_000, naesteId = 1;
    const timere = new Map();
    return {
        nu: () => nu,
        setTimeout(fn, ms) { const id = naesteId++; timere.set(id, { fn, tid: nu + Math.max(0, ms || 0) }); return id; },
        clearTimeout(id) { timere.delete(id); },
        setInterval(fn, ms) { const id = naesteId++; timere.set(id, { fn, tid: nu + ms, hver: ms }); return id; },
        clearInterval(id) { timere.delete(id); },
        ventende: () => [...timere.values()].filter(t => !t.hver).length,
        frem(ms) {
            const slut = nu + ms;
            for (;;) {
                let foerste = null;
                for (const [id, t] of timere) if (t.tid <= slut && (!foerste || t.tid < foerste[1].tid)) foerste = [id, t];
                if (!foerste) break;
                const [id, t] = foerste;
                nu = t.tid;
                if (t.hver) t.tid += t.hver; else timere.delete(id);
                t.fn();
            }
            nu = slut;
        }
    };
}

function lavMiljoe({ tilfaeldig = 0 } = {}) {
    const ur = lavUr();
    const kilder = [];
    class FalskEventSource {
        constructor(url) {
            this.url = url;
            this.readyState = 0; // CONNECTING
            this.lukket = false;
            this.lyttere = {};
            kilder.push(this);
        }
        addEventListener(navn, fn) { this.lyttere[navn] = fn; }
        close() { this.readyState = 2; this.lukket = true; }
        // Testens styring
        aabn() { this.readyState = 1; this.onopen && this.onopen(); }
        fejlPrøverIgen() { this.readyState = 0; this.onerror && this.onerror(); }
        fejlLukket() { this.readyState = 2; this.onerror && this.onerror(); }
        ping() { this.lyttere.ping && this.lyttere.ping(); }
    }
    FalskEventSource.CONNECTING = 0; FalskEventSource.OPEN = 1; FalskEventSource.CLOSED = 2;
    const dokLyttere = {};
    const sandkasse = {
        EventSource: FalskEventSource,
        setTimeout: ur.setTimeout, clearTimeout: ur.clearTimeout,
        setInterval: ur.setInterval, clearInterval: ur.clearInterval,
        Date: { now: ur.nu },
        Math: Object.assign(Object.create(Math), { random: () => tilfaeldig }),
        console: { warn() {}, error() {}, log() {} },
        document: {
            visibilityState: 'visible',
            addEventListener: (n, fn) => { dokLyttere[n] = fn; },
            removeEventListener: (n) => { delete dokLyttere[n]; }
        },
        JSON, encodeURIComponent
    };
    sandkasse.window = sandkasse;
    vm.runInNewContext(KILDE, sandkasse);
    const tilstand = [];
    const forb = sandkasse.LiveUpdates.connect({ onStateChange: (ok) => tilstand.push(ok) });
    const aabne = () => kilder.filter(k => !k.lukket && k.readyState !== 2);
    return { ur, kilder, aabne, forb, tilstand, dokLyttere, sandkasse };
}

test('110: CLOSED → ny forbindelse efter 3–7 s', () => {
    for (const [tilfaeldig, forventet] of [[0, 3000], [0.999, 6996]]) {
        const m = lavMiljoe({ tilfaeldig });
        assert.equal(m.kilder.length, 1);
        m.kilder[0].aabn();
        m.kilder[0].fejlLukket(); // fx 502 fra nginx under backend-genstart
        assert.equal(m.tilstand.at(-1), false, 'siden får besked og poller hurtigt imens');
        m.ur.frem(forventet - 1);
        assert.equal(m.kilder.length, 1, `ikke før ${forventet} ms`);
        m.ur.frem(1);
        assert.equal(m.kilder.length, 2, `efter ${forventet} ms`);
        m.kilder[1].aabn();
        assert.equal(m.tilstand.at(-1), true);
        assert.equal(m.aabne().length, 1, 'kun én forbindelse');
    }
});

test('110: CONNECTING → ingen ekstra forbindelse (browseren prøver selv igen)', () => {
    const m = lavMiljoe();
    m.kilder[0].aabn();
    m.kilder[0].fejlPrøverIgen();
    assert.equal(m.tilstand.at(-1), false);
    assert.equal(m.ur.ventende(), 0, 'ingen genåbning planlagt');
    m.ur.frem(60_000);
    assert.equal(m.kilder.length, 1);
    // Browseren får forbindelsen igen af sig selv
    m.kilder[0].aabn();
    assert.equal(m.tilstand.at(-1), true);
});

test('110: gentagne fejl → stigende ventetid med loft; nulstilles ved onopen', () => {
    const m = lavMiljoe({ tilfaeldig: 0 }); // ingen spredning: de rene trin
    const ventetider = [];
    for (let i = 0; i < 6; i++) {
        const k = m.kilder.at(-1);
        k.fejlLukket();
        const foer = m.kilder.length;
        let ventet = 0;
        while (m.kilder.length === foer) { m.ur.frem(500); ventet += 500; assert.ok(ventet < 60_000); }
        ventetider.push(ventet);
        assert.equal(m.ur.ventende(), 0, 'ingen timer tilbage efter genåbning');
    }
    assert.deepEqual(ventetider, [3000, 6000, 12000, 15000, 15000, 15000]);
    // Med fuld spredning er loftet under 20 s
    const s = lavMiljoe({ tilfaeldig: 0.999 });
    for (let i = 0; i < 5; i++) {
        s.kilder.at(-1).fejlLukket();
        const foer = s.kilder.length;
        s.ur.frem(19_000);
        assert.equal(s.kilder.length, foer + 1, `forsøg ${i + 1} inden for 19 s`);
    }
    // Lykkes det, starter næste fejl forfra på 3 s
    m.kilder.at(-1).aabn();
    m.kilder.at(-1).fejlLukket();
    const foer = m.kilder.length;
    m.ur.frem(3000);
    assert.equal(m.kilder.length, foer + 1);
});

test('110: close() stopper alt — ingen genåbning, ingen vagthund, ingen lytter', () => {
    const m = lavMiljoe();
    m.kilder[0].fejlLukket();
    assert.equal(m.ur.ventende(), 1);
    m.forb.close();
    assert.equal(m.ur.ventende(), 0);
    m.ur.frem(10 * 60_000);
    assert.equal(m.kilder.length, 1, 'ingen ny forbindelse efter close()');
    assert.equal(m.dokLyttere.visibilitychange, undefined);
    // close() med en åben forbindelse lukker den
    const n = lavMiljoe();
    n.kilder[0].aabn();
    n.forb.close();
    assert.ok(n.kilder[0].lukket);
    n.ur.frem(10 * 60_000);
    assert.equal(n.kilder.length, 1);
});

test('110: vagthunden og genåbningen giver aldrig to forbindelser eller to timere', () => {
    // Tavs forbindelse: vagthunden lukker og genforbinder (uændret, 70 s)
    const m = lavMiljoe();
    m.kilder[0].aabn();
    m.ur.frem(69_000);
    assert.equal(m.kilder.length, 1);
    m.ur.frem(20_000);
    assert.equal(m.kilder.length, 2, 'vagthunden genforbandt');
    assert.ok(m.kilder[0].lukket);
    // Den gamle forbindelses sene fejl må ikke planlægge noget
    m.kilder[0].onerror();
    assert.equal(m.ur.ventende(), 0);
    // Den nye lukker → én genåbning; vagthunden rører ikke en manglende forbindelse
    m.kilder[1].fejlLukket();
    assert.equal(m.ur.ventende(), 1);
    m.ur.frem(2000);
    assert.equal(m.ur.ventende(), 1, 'stadig kun én timer');
    m.ur.frem(5000);
    assert.equal(m.kilder.length, 3);
    assert.equal(m.aabne().length, 1);
    // Skærmen vækkes efter lang tid med en ventende genåbning: stadig én timer
    const v = lavMiljoe();
    v.kilder[0].aabn();
    v.kilder[0].fejlLukket();
    v.ur.frem(1000);
    v.dokLyttere.visibilitychange();
    assert.equal(v.ur.ventende(), 1);
    v.ur.frem(20_000);
    assert.equal(v.kilder.length, 2);
    assert.equal(v.aabne().length, 1);
});

test('110: live-updates.js?v= er skruet op på alle sider, der bruger den', () => {
    const sider = fs.readdirSync(path.join(ROD, 'frontend')).filter(f => f.endsWith('.html'));
    const med = sider.filter(f => /js\/live-updates\.js/.test(fs.readFileSync(path.join(ROD, 'frontend', f), 'utf8')));
    assert.deepEqual(med.sort(), ['admin.html', 'court-v3.html', 'oversigt.html', 'tv-v3.html']);
    for (const f of med) {
        assert.match(fs.readFileSync(path.join(ROD, 'frontend', f), 'utf8'), /js\/live-updates\.js\?v=3"/, f);
    }
});
