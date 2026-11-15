/**
 * Unit-tests: samme hændelse gemmes kun én gang (screens/haendelseslog.js).
 * På et dårligt net får serveren TV-PC'ens rapport, men svaret når ikke
 * tilbage — så sender PC'en den igen. Falsk master-database: gemmer rækkerne
 * og svarer på dublet-tjekket ud fra parametrene (4 pr. hændelse).
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let raekker = [];
let fejlVedTjek = false;
const sti = require.resolve('../../config/masterDatabase');
require.cache[sti] = {
    id: sti, filename: sti, loaded: true,
    exports: {
        query: async (sql, p) => {
            if (/^\s*INSERT/.test(sql)) {
                for (let i = 0; i < p.length; i += 12) {
                    raekker.push({ klub: p[i], klient_id: p[i + 1], type: p[i + 6], fra: +p[i + 7] });
                }
                return { affectedRows: p.length / 12 };
            }
            if (sql.includes('EXISTS')) {
                if (fejlVedTjek) throw new Error('forbindelsen tabt');
                const svar = [];
                for (let i = 0; i < p.length; i += 4) {
                    if (raekker.some(r => r.klub === p[i] && r.klient_id === p[i + 1] && r.type === p[i + 2] && r.fra === +p[i + 3])) {
                        svar.push({ i: i / 4 });
                    }
                }
                return svar;
            }
            throw new Error('uventet SQL: ' + sql);
        }
    }
};
const log = require('../../screens/haendelseslog');

const NU = Date.now();
const tv55 = { klientId: 'k-tv55', navn: 'badminton-tv55', bane: 5 };
const net = (fra, type = 'net-server') => ({ type, fra, til: fra + 76000, sek: 76, tekst: 'timeout' });

beforeEach(() => { raekker = []; fejlVedTjek = false; log._nulstilLoft(); });

test('samme hændelse sendt igen (svaret nåede ikke frem) gemmes ikke en gang til', async () => {
    await log.gem('lyngby', tv55, [net(NU - 5000), net(NU - 4000, 'net-ipv6')]);
    await log.gem('lyngby', tv55, [net(NU - 5000), net(NU - 4000, 'net-ipv6'), net(NU - 1000)]);
    assert.deepEqual(raekker.map(r => [r.type, r.fra]),
        [['net-server', NU - 5000], ['net-ipv6', NU - 4000], ['net-server', NU - 1000]]);
});

test('to ens i samme rapport gemmes én gang', async () => {
    await log.gem('lyngby', tv55, [net(NU - 5000), net(NU - 5000)]);
    assert.equal(raekker.length, 1);
});

test('samme tidspunkt, men anden type, skærm eller klub, er en anden hændelse', async () => {
    await log.gem('lyngby', tv55, [net(NU - 5000)]);
    await log.gem('lyngby', tv55, [net(NU - 5000, 'net-ipv6')]);
    await log.gem('lyngby', { ...tv55, klientId: 'k-tv2' }, [net(NU - 5000)]);
    await log.gem('demo', tv55, [net(NU - 5000)]);
    assert.equal(raekker.length, 4);
});

test('kan dublet-tjekket ikke svare, gemmes hændelserne alligevel', async () => {
    fejlVedTjek = true;
    await log.gem('lyngby', tv55, [net(NU - 5000)]);
    assert.equal(raekker.length, 1);
});

test('dubletter tæller ikke med i loftet pr. skærm', async () => {
    // 40 nye hændelser i timen er loftet — de samme sendt igen og igen tæller ikke
    for (let i = 0; i < 5; i++) await log.gem('lyngby', tv55, [net(NU - 5000)]);
    const nye = Array.from({ length: log.MAX_PR_TIME_SKAERM - 1 }, (_, i) => net(NU - 100000 - i * 1000));
    await log.gem('lyngby', tv55, nye);
    assert.equal(raekker.length, log.MAX_PR_TIME_SKAERM);
});
