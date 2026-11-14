// "Hent fejllog" fra admin (Adgangslinks): TV-PC'en sender sin log til serveren,
// så den ikke skal hentes med USB-nøglen (kiosk: /usr/lib/badminton-tv/fejllog).
//
// PC'en spørger hvert 2. minut (POST /api/screens/pc-fejllog/spoerg). Har admin
// trykket på knappen, svarer serveren { hent: true }, og PC'en samler loggen og
// sender den som zip (POST /api/screens/pc-fejllog). At den spørger, viser også,
// at den har en version, der kan det — ellers vises knappen ikke.
//
// Bestillingen er kun i hukommelsen (som "Installér nyeste nu"). Selve loggen
// gemmes på disken i <CLUB_BACKUP_DIR>/_pc-fejllog/<klub>/ (samme volume som
// klubbernes backups — ikke en mappe, nginx serverer), én pr. PC, i 7 dage.
// En zip tages kun imod, når admin har bedt om den — et lækket adgangslink kan
// ikke fylde disken.
//
// Ren logik + filerne — ruterne ligger i routes/screens.js.

const fs = require('fs');
const path = require('path');

const KAN_MS = 10 * 60 * 1000;            // har spurgt inden for så lang tid = kan
const BESTILT_MAX_MS = 60 * 60 * 1000;    // så længe venter en bestilling på PC'en
const BEHOLD_MS = 7 * 24 * 3600 * 1000;   // loggen ligger på serveren så længe
const MAX_BYTES = 10 * 1024 * 1024;

const PC_STATUS = new Set(['samler', 'fejl']);
const NAVN = /^[a-z0-9][a-z0-9-]{0,59}$/i;
const SIKKER_KLUB = /^[A-Za-z0-9_]+$/;
const VERSION = /^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,3}([.-][0-9A-Za-z.-]+)?$/;

const rodMappe = () => path.resolve(process.env.PC_FEJLLOG_DIR
    || path.join(process.env.CLUB_BACKUP_DIR || path.join(__dirname, '..', 'club-backups'), '_pc-fejllog'));

const register = new Map();   // tenant -> Map(`${tokenId}:${navn}` -> tilstand)

const tekst = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function hent(tenant, tokenId, navn, opret) {
    let pcer = register.get(tenant);
    if (!pcer) {
        if (!opret) return null;
        pcer = new Map();
        register.set(tenant, pcer);
    }
    const n = `${tokenId}:${navn}`;
    let t = pcer.get(n);
    if (!t && opret) {
        if (pcer.size >= 200) return null;   // loft pr. klub, som skærmlisten
        t = { sidstSpurgt: null, bestilt: null, status: null, tekst: '', tid: null };
        pcer.set(n, t);
    }
    return t;
}

function saetStatus(t, status, tekstStr, nu) {
    t.status = status;
    t.tekst = tekstStr || '';
    t.tid = nu;
}

// PC'ens spørgsmål: { navn, kioskVersion, status, tekst } eller null
function rensMelding(body) {
    if (!body || typeof body !== 'object') return null;
    const navn = tekst(body.navn, 60);
    if (!NAVN.test(navn)) return null;
    const status = body.status == null || body.status === '' ? null : String(body.status);
    if (status !== null && !PC_STATUS.has(status)) return null;
    const kv = tekst(body.kioskVersion, 30);
    return { navn, kioskVersion: VERSION.test(kv) ? kv : '', status, tekst: tekst(body.tekst, 300) };
}

// Er bestillingen for gammel, glemmes den (PC'en svarede aldrig)
function udloeb(t, nu) {
    if (t.bestilt && nu - t.bestilt > BESTILT_MAX_MS) {
        t.bestilt = null;
        saetStatus(t, 'fejl', "PC'en sendte ikke loggen inden for en time", nu);
    }
}

// PC'en spørger (og melder evt. status). Returnerer { hent }.
function spoerg(tenant, tokenId, m, nu = Date.now()) {
    const t = hent(tenant, tokenId, m.navn, true);
    if (!t) return { hent: false };
    t.sidstSpurgt = nu;
    udloeb(t, nu);
    if (m.status && t.bestilt) {
        saetStatus(t, m.status, m.tekst, nu);
        if (m.status === 'fejl') t.bestilt = null;
    }
    return { hent: !!t.bestilt };
}

// Admin trykker på knappen: 'ok' | 'kan-ikke' (PC'en har ikke spurgt for nylig)
function bestil(tenant, tokenId, navn, nu = Date.now()) {
    const t = hent(tenant, tokenId, navn, false);
    if (!t || !t.sidstSpurgt || nu - t.sidstSpurgt > KAN_MS) return 'kan-ikke';
    t.bestilt = nu;
    saetStatus(t, 'bestilt', '', nu);
    return 'ok';
}

// Må PC'en sende en zip nu? Kun når admin har bedt om den.
function venterPaaLog(tenant, tokenId, navn, nu = Date.now()) {
    const t = hent(tenant, tokenId, navn, false);
    if (!t) return false;
    udloeb(t, nu);
    return !!t.bestilt;
}

// ---- Filerne ----

function klubMappe(tenant) {
    if (!SIKKER_KLUB.test(String(tenant || ''))) throw new Error(`Ugyldig klub: ${tenant}`);
    return path.join(rodMappe(), tenant);
}

function stier(tenant, tokenId, navn) {
    if (!Number.isInteger(Number(tokenId)) || !NAVN.test(String(navn || ''))) return null;
    const base = path.join(klubMappe(tenant), `${Number(tokenId)}-${navn}`);
    return { zip: `${base}.zip`, meta: `${base}.json` };
}

const erZip = (buf) => Buffer.isBuffer(buf) && buf.length >= 22 && buf.readUInt32LE(0) === 0x04034b50;

// Slet logs over 7 dage i klubbens mappe
function ryd(tenant, nu = Date.now()) {
    let filer;
    try { filer = fs.readdirSync(klubMappe(tenant)); } catch { return; }
    for (const f of filer.filter(x => x.endsWith('.json'))) {
        const meta = path.join(klubMappe(tenant), f);
        let m = null;
        try { m = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch { /* ulæselig: slettes */ }
        if (!m || !(nu - m.tid <= BEHOLD_MS)) {
            for (const sti of [meta, meta.replace(/\.json$/, '.zip')]) {
                try { fs.unlinkSync(sti); } catch { /* findes ikke */ }
            }
        }
    }
}

// Gem PC'ens zip (erstatter den forrige). Returnerer metadata eller kaster.
function gem(tenant, tokenId, navn, buf, info = {}, nu = Date.now()) {
    if (!erZip(buf)) throw Object.assign(new Error('Ikke en zip-fil'), { status: 400 });
    if (buf.length > MAX_BYTES) throw Object.assign(new Error('Loggen er for stor'), { status: 413 });
    const s = stier(tenant, tokenId, navn);
    if (!s) throw Object.assign(new Error('Ugyldigt navn'), { status: 400 });
    fs.mkdirSync(path.dirname(s.zip), { recursive: true, mode: 0o700 });
    const opstarter = Number(info.opstarter);
    const kv = tekst(info.kioskVersion, 30);
    const meta = {
        tid: nu, stoerrelse: buf.length,
        opstarter: Number.isInteger(opstarter) && opstarter > 0 && opstarter <= 50 ? opstarter : null,
        kioskVersion: VERSION.test(kv) ? kv : ''
    };
    fs.writeFileSync(`${s.zip}.tmp`, buf, { mode: 0o600 });
    fs.renameSync(`${s.zip}.tmp`, s.zip);
    fs.writeFileSync(s.meta, JSON.stringify(meta), { mode: 0o600 });
    ryd(tenant, nu);

    const t = hent(tenant, tokenId, navn, true);
    if (t) {
        t.bestilt = null;
        saetStatus(t, 'klar', '', nu);
    }
    return meta;
}

// { sti, meta } for PC'ens seneste log (højst 7 dage gammel), ellers null
function hentFil(tenant, tokenId, navn, nu = Date.now()) {
    let s;
    try { s = stier(tenant, tokenId, navn); } catch { return null; }
    if (!s) return null;
    try {
        const meta = JSON.parse(fs.readFileSync(s.meta, 'utf8'));
        if (!(nu - meta.tid <= BEHOLD_MS) || !fs.existsSync(s.zip)) return null;
        return { sti: s.zip, meta };
    } catch {
        return null;
    }
}

// Til admins skærmliste: { kan, status, tekst, tid, fil } eller null
function forSkaerm(tenant, tokenId, navn, nu = Date.now()) {
    if (!navn || tokenId == null) return null;
    const t = hent(tenant, tokenId, navn, false);
    if (t) udloeb(t, nu);
    const fil = hentFil(tenant, tokenId, navn, nu);
    if (!t && !fil) return null;
    return {
        kan: !!(t && t.sidstSpurgt && nu - t.sidstSpurgt <= KAN_MS),
        status: t && t.status !== 'klar' ? t.status : null,
        tekst: t && t.status !== 'klar' ? t.tekst : '',
        tid: t && t.status !== 'klar' ? t.tid : null,
        fil: fil ? fil.meta : null
    };
}

// Filnavnet admin får: tv2-fejllog-2026-11-15-1032.zip (dansk tid)
function downloadNavn(navn, tid) {
    const d = new Date(tid);
    const dele = Object.fromEntries(new Intl.DateTimeFormat('da-DK', {
        timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).map(p => [p.type, p.value]));
    return `${navn}-fejllog-${dele.year}-${dele.month}-${dele.day}-${dele.hour}${dele.minute}.zip`;
}

function _nulstil() { register.clear(); }

module.exports = {
    rensMelding, spoerg, bestil, venterPaaLog, gem, hentFil, forSkaerm, downloadNavn, ryd, erZip,
    _nulstil, KAN_MS, BESTILT_MAX_MS, BEHOLD_MS, MAX_BYTES
};
