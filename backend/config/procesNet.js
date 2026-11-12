// Sikkerhedsnet for hele backend-processen (nr. 95).
//
// Før døde processen stille ved den første fejl, ingen fangede: et promise,
// der blev afvist uden .catch, eller en kastet fejl i en hændelse (fx emit('error')
// uden lytter). Docker startede den igen, men alle klubber var nede imens, og
// loggen sagde ikke tydeligt hvorfor.
//
// unhandledRejection: logges med stak, og processen kører videre. Ét afvist
// promise betyder, at én forespørgsel eller ét job fejlede — ikke at processen
// er i stykker, så resten af klubberne skal ikke lukkes ned for det.
//
// uncaughtException: logges tydeligt, og processen afslutter (kode 1), så Docker
// (restart: unless-stopped) starter den forfra. Efter en kastet fejl, ingen
// fangede, kan processens tilstand være halvvejs ændret — at køre videre er
// farligere end en genstart på få sekunder. Dagens YouTube-forbrug gemmes først
// (højst 2 s), ellers ville en genstart glemme det.

function beskriv(fejl) {
    return (fejl && fejl.stack) || String(fejl);
}

function installer({ proc = process, log = console, foerAfslut = async () => {}, afslut = (kode) => process.exit(kode), ventMs = 2000 } = {}) {
    proc.on('unhandledRejection', (grund) => {
        log.error(`✗ Et promise blev afvist, uden at nogen fangede det — backenden kører videre:\n${beskriv(grund)}`);
    });
    proc.on('uncaughtException', (fejl, oprindelse) => {
        log.error(`✗ Uhåndteret fejl (${oprindelse || 'uncaughtException'}) — backenden genstarter:\n${beskriv(fejl)}`);
        let afsluttet = false;
        const slut = () => { if (!afsluttet) { afsluttet = true; afslut(1); } };
        const t = setTimeout(slut, ventMs);
        if (t.unref) t.unref();
        Promise.resolve().then(foerAfslut).catch(() => {}).finally(() => { clearTimeout(t); slut(); });
    });
}

module.exports = { installer };
