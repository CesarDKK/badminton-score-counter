/**
 * YouTube-API'et (Google OAuth + YouTube Data API v3, live-delen).
 *
 * Klubben forbinder sin kanal én gang (admin → Livestream). Så kan serveren
 * oprette en udsendelse, hver gang en bane begynder at sende, og en fast
 * stream (nøgle) pr. bane. Se docs/youtube-api-opsaetning.md for opsætningen
 * hos Google. Login-klienten (Client ID + Client secret) indtastes i super-admin
 * (config/youtubeKlient.js gemmer den i master-databasen) eller sættes som
 * YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET i .env, som går forud.
 *
 * Adresserne kan peges om (YOUTUBE_*_URL) — det bruger testene til en falsk
 * Google-server.
 */

const SCOPE = 'https://www.googleapis.com/auth/youtube';
const TIMEOUT_MS = 15000;

const env = (navn, standard) => process.env[navn] || standard;
const adresser = () => ({
    auth: env('YOUTUBE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    token: env('YOUTUBE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    revoke: env('YOUTUBE_REVOKE_URL', 'https://oauth2.googleapis.com/revoke'),
    api: env('YOUTUBE_API_URL', 'https://www.googleapis.com/youtube/v3')
});

// Badmintonapps login-klient hos Google. .env går forud for den, super-admin har gemt.
let _gemt = null; // { id, secret }
function klient() {
    if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) {
        return { id: process.env.YOUTUBE_CLIENT_ID, secret: process.env.YOUTUBE_CLIENT_SECRET, kilde: 'env' };
    }
    return _gemt ? { ..._gemt, kilde: 'admin' } : null;
}
const konfigureret = () => !!klient();

// Den gemte klient (fra master-databasen) — null fjerner den. Klubbernes
// adgangstokens hører til klienten, så de glemmes.
function brugKlient(id, secret) {
    _gemt = id && secret ? { id, secret } : null;
    _adgang.clear();
}

// Den fælles adresse, Google sender klubben tilbage til (registreret hos Google)
const tilbageAdresse = () => process.env.YOUTUBE_REDIRECT_URI ||
    `https://${process.env.APP_DOMAIN || 'badmintonapp.dk'}/youtube/callback`;

// Fejl fra Google — besked er på dansk og kan vises i admin
class YoutubeFejl extends Error {
    constructor(besked, { status = 0, grund = '' } = {}) {
        super(besked);
        this.status = status;
        this.grund = grund;
    }
}

const BESKEDER = {
    invalid_grant: 'Adgangen til YouTube er udløbet eller fjernet — forbind kanalen igen',
    liveStreamingNotEnabled: 'Kanalen har ikke livestreaming slået til. Slå det til i YouTube Studio → Gå live (første gang tager det op til 24 timer)',
    livePermissionBlocked: 'YouTube har spærret livestreaming på kanalen',
    quotaExceeded: 'YouTube-API\'ets kvote for i dag er brugt op — prøv igen i morgen',
    insufficientPermissions: 'Badmintonapp har ikke adgang til at oprette udsendelser på kanalen — forbind kanalen igen',
    forbidden: 'YouTube afviste — Badmintonapp har ikke adgang til kanalen'
};

async function kald(url, { method = 'GET', token, body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let data;
    if (form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        data = new URLSearchParams(form).toString();
    } else if (body) {
        headers['Content-Type'] = 'application/json';
        data = JSON.stringify(body);
    }
    let r;
    try {
        r = await fetch(url, { method, headers, body: data, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
        throw new YoutubeFejl(`Kunne ikke nå YouTube (${e.name === 'TimeoutError' ? 'timeout' : e.message})`);
    }
    if (r.status === 204) return null;
    const json = await r.json().catch(() => null);
    if (r.ok) return json;
    // API'et: { error: { code, message, errors: [{ reason }] } }; OAuth: { error: 'invalid_grant', error_description }
    const e = json && json.error;
    const grund = typeof e === 'string' ? e : (e && e.errors && e.errors[0] && e.errors[0].reason) || '';
    const besked = BESKEDER[grund] ||
        `YouTube svarede ${r.status}${(e && e.message) || (json && json.error_description) ? `: ${(e && e.message) || json.error_description}` : ''}`;
    throw new YoutubeFejl(besked, { status: r.status, grund });
}

const api = (sti, params, opts = {}) =>
    kald(`${adresser().api}/${sti}?${new URLSearchParams(params).toString()}`, opts);

// ---- Login (OAuth) ----

function loginAdresse(state) {
    const q = new URLSearchParams({
        client_id: klient().id,
        redirect_uri: tilbageAdresse(),
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        // Altid samtykke-skærmen: ellers giver Google intet refresh-token, når
        // kanalen har været forbundet før
        prompt: 'consent',
        include_granted_scopes: 'true',
        state
    });
    return `${adresser().auth}?${q.toString()}`;
}

// Koden fra Google → { refresh_token, access_token, expires_in }
async function byttKode(code) {
    const t = await kald(adresser().token, { method: 'POST', form: {
        code, client_id: klient().id, client_secret: klient().secret,
        redirect_uri: tilbageAdresse(), grant_type: 'authorization_code'
    } });
    if (!t || !t.refresh_token) throw new YoutubeFejl('Google gav ingen varig adgang — prøv at forbinde igen');
    return t;
}

// Adgangstokens udløber efter en time — de huskes pr. klub, til lige før
const _adgang = new Map(); // tenant -> { refresh, token, udloeber }

async function adgangsToken(tenant, refresh) {
    const gemt = _adgang.get(tenant);
    if (gemt && gemt.refresh === refresh && gemt.udloeber - Date.now() > 60 * 1000) return gemt.token;
    const t = await kald(adresser().token, { method: 'POST', form: {
        refresh_token: refresh, client_id: klient().id,
        client_secret: klient().secret, grant_type: 'refresh_token'
    } });
    _adgang.set(tenant, { refresh, token: t.access_token, udloeber: Date.now() + (Number(t.expires_in) || 3600) * 1000 });
    return t.access_token;
}

const glemAdgang = (tenant) => _adgang.delete(tenant);

// Kender Google klienten? Et kodebytte med en ugyldig kode afslører det:
// invalid_client = forkert Client ID eller secret, alt andet = klienten findes.
async function tjekKlient(id, secret) {
    try {
        await kald(adresser().token, { method: 'POST', form: {
            code: 'badmintonapp-tjek', client_id: id, client_secret: secret,
            redirect_uri: tilbageAdresse(), grant_type: 'authorization_code'
        } });
    } catch (e) {
        if (e.grund === 'invalid_client' || e.grund === 'unauthorized_client') return false;
        if (!e.status) throw e; // kunne ikke nå Google
    }
    return true;
}

async function tilbagekald(refresh) {
    await kald(adresser().revoke, { method: 'POST', form: { token: refresh } }).catch(() => {});
}

// ---- Kanalen, streams og udsendelser ----

// Kanalen, adgangen gælder: { id, navn } eller null
async function kanal(token) {
    const r = await api('channels', { part: 'snippet', mine: 'true' }, { token });
    const k = r && r.items && r.items[0];
    return k ? { id: k.id, navn: (k.snippet && k.snippet.title) || '' } : null;
}

// En fast stream (nøgle) til en bane: { id, url, noegle }
async function opretStream(token, titel) {
    const s = await api('liveStreams', { part: 'snippet,cdn,contentDetails' }, { token, method: 'POST', body: {
        snippet: { title: titel },
        cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
        contentDetails: { isReusable: true }
    } });
    const ind = s && s.cdn && s.cdn.ingestionInfo;
    if (!ind || !ind.streamName) throw new YoutubeFejl('YouTube gav ingen stream-nøgle');
    return { id: s.id, url: ind.rtmpsIngestionAddress || ind.ingestionAddress, noegle: ind.streamName };
}

// En ny udsendelse, der går live af sig selv, når billedet kommer, koblet til
// banens stream. Serveren afslutter den, når banen holder op med at sende
// (afslut); YouTube afslutter den selv ca. et minut efter, at billedet er væk
// (PC'en slukket) — en kort pause, mens PC'en genstarter streamen, lukker den
// ikke. Returnerer id'et.
async function opretUdsendelse(token, { titel, beskrivelse, synlighed, boern, streamId }) {
    const b = await api('liveBroadcasts', { part: 'snippet,status,contentDetails' }, { token, method: 'POST', body: {
        snippet: { title: titel, description: beskrivelse, scheduledStartTime: new Date().toISOString() },
        status: { privacyStatus: synlighed, selfDeclaredMadeForKids: !!boern },
        contentDetails: {
            enableAutoStart: true, enableAutoStop: true, enableDvr: true, enableEmbed: true,
            recordFromStart: true, latencyPreference: 'normal', monitorStream: { enableMonitorStream: false }
        }
    } });
    try {
        await api('liveBroadcasts/bind', { id: b.id, part: 'id,contentDetails', streamId }, { token, method: 'POST' });
    } catch (e) {
        await api('liveBroadcasts', { id: b.id }, { token, method: 'DELETE' }).catch(() => {});
        throw e;
    }
    return b.id;
}

// Udsendelsens livscyklus ('created', 'ready', 'testing', 'live', 'complete',
// 'revoked' …) eller null, når den ikke findes længere
async function udsendelsesStatus(token, id) {
    const r = await api('liveBroadcasts', { part: 'status', id }, { token });
    const b = r && r.items && r.items[0];
    return b ? b.status.lifeCycleStatus : null;
}

// Udsendelsen live med det samme (hvis auto-start ikke nåede at tage den, fordi
// billedet kom, før den var oprettet)
const gaaLive = (token, id) =>
    api('liveBroadcasts/transition', { broadcastStatus: 'live', id, part: 'status' }, { token, method: 'POST' });

// Udsendelsen er slut: en, der har været live, afsluttes (videoen bliver
// liggende på kanalen); en, der aldrig kom i gang, slettes
async function afslut(token, id) {
    const status = await udsendelsesStatus(token, id);
    if (status === 'live' || status === 'testing' || status === 'liveStarting') {
        await api('liveBroadcasts/transition', { broadcastStatus: 'complete', id, part: 'status' }, { token, method: 'POST' });
        return 'afsluttet';
    }
    if (status === 'created' || status === 'ready' || status === 'testStarting') {
        await api('liveBroadcasts', { id }, { token, method: 'DELETE' });
        return 'slettet';
    }
    return status || 'findes-ikke';
}

module.exports = {
    SCOPE, YoutubeFejl, konfigureret, klient, brugKlient, tjekKlient, tilbageAdresse, loginAdresse, byttKode, adgangsToken, glemAdgang,
    tilbagekald, kanal, opretStream, opretUdsendelse, udsendelsesStatus, gaaLive, afslut
};
