/**
 * Visningsnavne til TV-skærmen: kun fornavn, med forbogstav ved sammenfald.
 *
 * Navne fylder for meget på skærmen, så vi viser kun fornavnet:
 *   "Anna Marie Jensen"        → "Anna"
 *   "Jens-Peter Hansen-Olsen"  → "Jens-Peter"   (bindestreg er ét ord)
 *   "Jesper"                   → "Jesper"
 *   "Anna Jensen / A. Jensen"  → "Anna"         (alias efter "/" ignoreres)
 *
 * Hedder to spillere i samme kamp det samme, får de efternavnets forbogstav,
 * så man kan kende dem fra hinanden: "Anna J." og "Anna K.". Er selv
 * forbogstavet ens, vises hele efternavnet.
 *
 * Ren logik uden DOM — bruges af tv-script-v3.js (window.NameDisplay) og af
 * backend/tests/unit/name-display.test.js (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NameDisplay = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    function ord(fullName) {
        const uden = String(fullName || '').split('/')[0];
        return uden.trim().split(/\s+/).filter(Boolean);
    }

    /** Fornavnet alene. */
    function fornavn(fullName) {
        const o = ord(fullName);
        return o.length ? o[0] : '';
    }

    /** Efternavnet (sidste ord), eller '' hvis der kun er ét ord. */
    function efternavn(fullName) {
        const o = ord(fullName);
        return o.length > 1 ? o[o.length - 1] : '';
    }

    /**
     * Visningsnavne for en hel kamp. Tager de fulde navne i visningsrækkefølge
     * (tomme strenge for pladser der ikke er i brug, fx makker i single) og
     * returnerer én visningsstreng pr. plads. Sammenfald afgøres på tværs af
     * ALLE pladser — også modstandere.
     */
    function visningsnavne(fuldeNavne) {
        const navne = (fuldeNavne || []).map((n) => String(n || ''));
        const forn = navne.map(fornavn);

        // Hvor mange gange forekommer hvert fornavn? (uden tomme)
        const antal = new Map();
        for (const f of forn) {
            if (!f) continue;
            const k = f.toLocaleLowerCase('da');
            antal.set(k, (antal.get(k) || 0) + 1);
        }

        // Første pas: fornavn + forbogstav ved sammenfald
        const ud = navne.map((n, i) => {
            const f = forn[i];
            if (!f) return '';
            if ((antal.get(f.toLocaleLowerCase('da')) || 0) < 2) return f;
            const e = efternavn(n);
            return e ? `${f} ${e[0].toLocaleUpperCase('da')}.` : f;
        });

        // Andet pas: er "Anna J." stadig ens for to spillere, vis hele efternavnet
        const antalUd = new Map();
        for (const u of ud) {
            if (!u) continue;
            const k = u.toLocaleLowerCase('da');
            antalUd.set(k, (antalUd.get(k) || 0) + 1);
        }
        return ud.map((u, i) => {
            if (!u || (antalUd.get(u.toLocaleLowerCase('da')) || 0) < 2) return u;
            const e = efternavn(navne[i]);
            return e ? `${forn[i]} ${e}` : u;
        });
    }

    return { fornavn, efternavn, visningsnavne };
}));
