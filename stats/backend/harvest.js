/**
 * Indsamling af en klubs holdturneringssæson.
 *
 * Fire trin, hvert baseret på badmintonplayer's egne kald:
 *   1. Klubbens rækker i sæsonen            (subPage 6)  — 1 kald
 *   2. Puljestilling pr. række → hold-id'er (subPage 2)  — ~40 kald
 *   3. Kampprogram pr. hold → kampnumre     (subPage 3)  — ~40 kald
 *   4. Holdseddel pr. kamp → spillere       (subPage 5)  — ~220 kald
 *
 * Der er ét job ad gangen (se kø nederst), og klienten venter mellem kaldene.
 * En hel klub tager typisk 4-7 minutter, og resultatet caches, så det normalt
 * kun sker én gang i døgnet pr. klub og sæson.
 */

const bp = require('./badmintonplayer');
const P = require('./parse');

const AARGANG = {
    2: 'U09', 3: 'U11', 4: 'U13', 5: 'U15', 6: 'U17', 7: 'U19', 20: 'U23',
    18: 'U17/U19', 21: 'UNG', 1: 'SEN', 19: 'SEN+30', 8: 'SEN+35', 9: 'SEN+40',
    10: 'SEN+45', 11: 'SEN+50', 12: 'SEN+55', 13: 'SEN+60', 14: 'SEN+65',
    17: 'SEN+70', 22: 'SEN+75', 28: 'SEN+80', 16: 'MOT', 15: 'Andet',
    23: 'U10', 29: 'U08', 24: 'U12', 25: 'U14', 26: 'U16', 27: 'U18'
};

/** Rækkefølge til visning — yngst først, derefter senior og veteran. */
const AARGANG_ORDEN = ['U08', 'U09', 'U10', 'U11', 'U12', 'U13', 'U14', 'U15', 'U16',
    'U17', 'U17/U19', 'U18', 'U19', 'U23', 'UNG', 'SEN', 'SEN+30', 'SEN+35', 'SEN+40',
    'SEN+45', 'SEN+50', 'SEN+55', 'SEN+60', 'SEN+65', 'SEN+70', 'SEN+75', 'SEN+80',
    'MOT', 'Andet'];

/**
 * Et hold hedder fx "Lyngby 3". Vi matcher klubnavnet efterfulgt af enten intet
 * eller et holdnummer, så "Lyngby" ikke fanger "Lyngby-Taarbæk" og omvendt.
 */
function holdMatcher(klubNavn) {
    const rent = klubNavn.trim().toLowerCase();
    return (navn) => {
        const n = String(navn || '').trim().toLowerCase();
        if (!n.startsWith(rent)) return false;
        const rest = n.slice(rent.length).trim();
        return rest === '' || /^\d+$/.test(rest) || /^\d+\s*\(/.test(rest);
    };
}

/**
 * Kører hele indsamlingen. `onProgress({fase, faerdig, total})` kaldes undervejs.
 * Returnerer rådata som aggregate.js kan regne på.
 */
async function harvestClub({ clubId, clubName, season, onProgress = () => {} }) {
    const erKlub = holdMatcher(clubName);
    const rapport = (fase, faerdig, total) => onProgress({ fase, faerdig, total });

    // 1 — klubbens rækker
    rapport('raekker', 0, 1);
    const oversigtHtml = await bp.standing({ subPage: 6, seasonID: season, clubID: clubId });
    const raekker = P.parseClubOverview(oversigtHtml);
    rapport('raekker', 1, 1);
    if (!raekker.length) return { klub: clubName, clubId, season, hold: [], kampe: [], deltagelser: [] };

    // 2 — hold-id'er pr. række
    const hold = [];
    const setteHold = new Set();
    for (let i = 0; i < raekker.length; i++) {
        const r = raekker[i];
        const html = await bp.standing({
            subPage: 2, seasonID: season, leagueGroupID: r.leagueGroupID,
            ageGroupID: r.ageGroupID, regionID: r.regionID, clubID: clubId
        });
        // Stillingstabellen står på samme side — den tager vi med, nu hvor vi
        // alligevel har hentet den.
        const stilling = P.parsePoolStandings(html);
        for (const t of P.parsePoolTeams(html, erKlub)) {
            if (setteHold.has(t.teamID)) continue;
            setteHold.add(t.teamID);
            const egen = stilling.find((s) => s.hold === t.navn) || null;
            hold.push({
                teamID: t.teamID,
                navn: t.navn,
                raekke: r.raekke,
                // Årgangs-etiketten må ikke indeholde mellemrum: holdnøglen er
                // "<aargang> <holdnavn>", og frontenden deler på første mellemrum.
                aargang: AARGANG[Number(r.ageGroupID)] || `Årgang-${r.ageGroupID}`,
                leagueGroupID: r.leagueGroupID,
                ageGroupID: r.ageGroupID,
                regionID: r.regionID,
                placering: egen ? { ...egen, antalHold: stilling.length } : null
            });
        }
        rapport('hold', i + 1, raekker.length);
    }

    // 3 — kampnumre pr. hold
    const kampRef = new Map(); // kampnr -> hold
    for (let i = 0; i < hold.length; i++) {
        const t = hold[i];
        const html = await bp.standing({
            subPage: 3, seasonID: season, leagueGroupID: t.leagueGroupID,
            ageGroupID: t.ageGroupID, regionID: t.regionID,
            leagueGroupTeamID: t.teamID, clubID: clubId
        });
        for (const nr of P.parseTeamMatches(html)) {
            if (!kampRef.has(nr)) kampRef.set(nr, t);
        }
        rapport('kampprogram', i + 1, hold.length);
    }

    // 4 — holdsedler
    const kampe = [];
    const deltagelser = [];
    const numre = [...kampRef.keys()];
    let fejlede = 0;
    for (let i = 0; i < numre.length; i++) {
        const nr = numre[i];
        const t = kampRef.get(nr);
        try {
            const html = await bp.standing({ subPage: 5, seasonID: season, leagueMatchID: nr, clubID: clubId });
            const kamp = P.parseMatch(html, erKlub);
            if (kamp) {
                const eget = kamp.side === 'hjemme' ? kamp.hjemme
                    : kamp.side === 'ude' ? kamp.ude
                    : kamp.side === 'begge' ? `${kamp.hjemme} / ${kamp.ude}`
                    : t.navn;
                kampe.push({
                    kampnr: nr, tid: kamp.tid, resultat: kamp.resultat,
                    hjemme: kamp.hjemme, ude: kamp.ude, side: kamp.side,
                    hold: eget, raekke: t.raekke, aargang: t.aargang
                });
                for (const s of kamp.spillere) {
                    // Hver spiller tildeles sit eget holds navn ud fra hvilken side
                    // vedkommende spillede på — vigtigt i interne klubkampe.
                    const spillerHold = s.side === 'hjemme' ? kamp.hjemme
                        : s.side === 'ude' ? kamp.ude
                        : eget;
                    deltagelser.push({
                        kampnr: nr, tid: kamp.tid, spillerId: s.id, navn: s.navn,
                        disciplin: s.disciplin, vundet: s.vundet, wo: s.wo, side: s.side,
                        hold: spillerHold, raekke: t.raekke, aargang: t.aargang
                    });
                }
            }
        } catch (e) {
            // En enkelt kamp der fejler må ikke vælte hele indsamlingen.
            fejlede++;
            kampe.push({ kampnr: nr, fejl: String(e.message || e), hold: t.navn, raekke: t.raekke, aargang: t.aargang });
        }
        rapport('holdsedler', i + 1, numre.length);
    }

    // Systematisk fejl opstrøms (fx badmintonplayer begynder at svare 500 midt i):
    // så er resultatet ubrugeligt og må IKKE gemmes som gyldigt oven i gode data.
    // Vi kaster, så jobbet markeres fejlet og cachen ikke røres.
    if (numre.length >= 10 && fejlede > numre.length / 2) {
        throw new Error(`For mange kampe fejlede (${fejlede} af ${numre.length}) — badmintonplayer svarer ustabilt. Prøv igen senere.`);
    }

    return { klub: clubName, clubId, season, hold, kampe, deltagelser };
}

/** Estimeret antal opstrømskald — bruges til at vise en realistisk ventetid. */
function estimerKald(antalRaekker) {
    return 1 + antalRaekker * 2 + antalRaekker * 6;
}

module.exports = { harvestClub, AARGANG, AARGANG_ORDEN, holdMatcher, estimerKald };
