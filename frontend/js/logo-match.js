// Delt logo-matcher: udleder et centralt klub-logo ud fra et hold-/klubnavn.
// Delvist match — normaliseret navn INDEHOLDER klubnavn/alias; laengste noegle vinder.
(function (global) {
    function norm(s) {
        return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }
    // Navne-normalisering: fjern seed "[n]" og endelses-holdnummer/romertal ("Lyngby 1" -> "lyngby")
    function normalizeName(s) {
        let t = String(s || '').replace(/\s*\[\d+\]\s*$/, '');
        t = t.replace(/\s+(?:\d{1,3}|i{1,3}|iv|v)$/i, '');
        return norm(t);
    }
    function logoKeys(logo) {
        const keys = [logo.club_name];
        if (logo.aliases) String(logo.aliases).split(',').forEach(a => keys.push(a));
        return keys.map(norm).filter(Boolean);
    }
    function matchLogo(name, logos) {
        const n = normalizeName(name);
        if (!n || !Array.isArray(logos)) return null;
        let best = null, bestLen = 0;
        for (const logo of logos) {
            for (const key of logoKeys(logo)) {
                if (n.includes(key) && key.length > bestLen) {
                    best = logo;
                    bestLen = key.length;
                }
            }
        }
        return best;
    }
    global.LogoMatch = { normalizeName, matchLogo };
})(window);
