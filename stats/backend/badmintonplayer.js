/**
 * Klient til badmintonplayer.dk's egen holdturnerings-API.
 *
 * Siden bruger et ASMX-webservice-endpoint, GetLeagueStanding, som HoldTurnering-
 * siden selv kalder når man klikker rundt i menuerne. Vi kalder præcis samme
 * endpoint med samme parametre — der er ingen login, ingen token og ingen captcha
 * involveret i selve API'et (bot-beskyttelsen sidder på HTML-sidens skal, ikke på
 * webservicen).
 *
 * subPage bestemmer hvad man får:
 *   2 = stilling for en pulje (giver holdenes leagueGroupTeamID)
 *   3 = holdets kampprogram (giver kampnumre)
 *   5 = én kamps holdseddel (giver spillerne)
 *   6 = alle rækker en klub er tilmeldt i en sæson
 */

const ENDPOINT = 'https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx';
const REFERER = 'https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/';
const UA = 'BadmintonApp.dk statistik (+https://statistik.badmintonapp.dk)';

// Statisk nøgle som siden selv lægger i sin HTML. Kan skiftes uden varsel, så den
// hentes automatisk igen hvis kaldene begynder at fejle.
const DEFAULT_CONTEXT = '3E1C76F286005A1357D08419AD57AA0014A541262CDC46155C2673B67364D66DD03ADCB222A067E337848734C71C2719';

let contextKey = process.env.BP_CONTEXT_KEY || DEFAULT_CONTEXT;

/** Minimum ventetid mellem to kald opstrøms — vi vil ikke belaste badmintonplayer. */
const MIN_DELAY_MS = Number(process.env.BP_MIN_DELAY_MS) || 700;
const JITTER_MS = Number(process.env.BP_JITTER_MS) || 400;

let lastCall = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
    const wait = lastCall + MIN_DELAY_MS + Math.random() * JITTER_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
}

/** Henter en frisk contextkey fra siden hvis den vi har er blevet ugyldig. */
async function refreshContextKey() {
    const res = await fetch(REFERER, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    const m = html.match(/CallbackContext\s*=\s*'([^']+)'/);
    if (m) {
        contextKey = m[1];
        return true;
    }
    return false;
}

async function post(method, payload, { retryOnAuthError = true } = {}) {
    await throttle();
    const res = await fetch(`${ENDPOINT}/${method}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'User-Agent': UA,
            'Referer': REFERER
        },
        body: JSON.stringify({ callbackcontextkey: contextKey, ...payload })
    });

    if (res.status === 500 && retryOnAuthError) {
        // Typisk symptom på en udløbet contextkey — hent en ny og prøv én gang til.
        if (await refreshContextKey()) return post(method, payload, { retryOnAuthError: false });
    }
    if (!res.ok) throw new Error(`badmintonplayer svarede ${res.status} på ${method}`);

    const json = await res.json();
    return json.d || {};
}

/** Fritekstsøgning på klubnavn. Returnerer [{ id, navn }]. */
async function searchClub(name) {
    const d = await post('SearchClub', {
        name,
        selectfunction: 'SelectClub',
        includeteams: false
    });
    const html = d.Html || '';
    const klubber = [];
    const re = /SelectClub\('(\d+)',\s*'([^']*)'\)/g;
    let m;
    while ((m = re.exec(html))) {
        klubber.push({ id: m[1], navn: decodeEntities(m[2]) });
    }
    return { klubber, afkortet: !!d.ListTruncated };
}

/** Rå HTML fra GetLeagueStanding. */
async function standing({ subPage, seasonID = '', leagueGroupID = '', ageGroupID = '',
                          regionID = '', leagueGroupTeamID = '', leagueMatchID = '',
                          clubID = '', playerID = '' }) {
    const d = await post('GetLeagueStanding', {
        subPage: String(subPage), seasonID: String(seasonID), leagueGroupID: String(leagueGroupID),
        ageGroupID: String(ageGroupID), regionID: String(regionID),
        leagueGroupTeamID: String(leagueGroupTeamID), leagueMatchID: String(leagueMatchID),
        clubID: String(clubID), playerID: String(playerID)
    });
    return d.html || '';
}

function decodeEntities(s) {
    return String(s)
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

module.exports = { searchClub, standing, decodeEntities, refreshContextKey, MIN_DELAY_MS };
