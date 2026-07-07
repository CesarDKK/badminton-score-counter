// Delt logo-matcher for footballapp — samme princip som badminton-appens:
// et holds logo udledes automatisk af holdnavnet, hvis intet er valgt manuelt.
// Delvist match: normaliseret holdnavn INDEHOLDER logonavn/alias; længste nøgle vinder.
// teams.logo_path styrer: null = auto (match på navn), 'none' = tvunget intet logo,
// alt andet = eksplicit valgt logo-url.
(function (global) {
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Navne-normalisering: fjern seed "[n]" og endelses-holdnummer/romertal ("Lyngby 2" -> "lyngby")
  function normalizeName(s) {
    let t = String(s || '').replace(/\s*\[\d+\]\s*$/, '');
    t = t.replace(/\s+(?:\d{1,3}|i{1,3}|iv|v)$/i, '');
    return norm(t);
  }

  function logoKeys(logo) {
    const keys = [logo.name];
    if (logo.aliases) String(logo.aliases).split(',').forEach((a) => keys.push(a));
    return keys.map(norm).filter(Boolean);
  }

  function matchLogo(name, logos) {
    const n = normalizeName(name);
    if (!n || !Array.isArray(logos)) return null;
    let best = null;
    let bestLen = 0;
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

  // Udleder et teams logo-url (relativ sti til /api/uploads/) eller null.
  function resolveTeamLogoUrl(team, logos) {
    if (!team) return null;
    if (team.logo_path === 'none') return null;
    if (team.logo_path) return team.logo_path;
    const match = matchLogo(team.name, logos);
    return match ? match.url : null;
  }

  global.FLogoMatch = { normalizeName, matchLogo, resolveTeamLogoUrl };
})(window);
