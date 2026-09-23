const fs = require('fs');
const path = require('path');

// Sponsorbilleder ligger i <UPLOAD_DIR>/<klubmappe>/<fil>, og sponsor_images.filename
// er '<klubmappe>/<fil>' (klubmappe = klubbens db_name, 'local' ved direkte adgang).
//
// Stien til en fil, der skal læses eller slettes, bygges ALTID her ud fra filnavnet
// og klubbens egen mappe — aldrig fra kolonnen file_path. file_path kan komme fra en
// uploadet backup-fil, og før slettede "Slet billede" den sti, der stod dér: en
// gendannet række med file_path '/app/server.js' eller en anden klubs billede fik
// serveren til at slette den fil.

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));

const SIKKERT_FILNAVN = /^[A-Za-z0-9_.-]+$/;
const TILLADTE_ENDELSER = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// Et rent filnavn (ingen mapper) med en billed-endelse, ellers null
function rentFilnavn(navn) {
    if (typeof navn !== 'string') return null;
    if (!SIKKERT_FILNAVN.test(navn) || navn.includes('..')) return null;
    if (!TILLADTE_ENDELSER.has(path.extname(navn).toLowerCase())) return null;
    return navn;
}

const klubMappe = (req) => req.clubDbName || 'local';

// Absolut sti til en sponsorfil ud fra filename-kolonnen — kun hvis filen hører
// til klubbens egen mappe ('<klubmappe>/<fil>'). Alt andet giver null (rør intet).
function sponsorFilSti(mappe, filename) {
    if (typeof filename !== 'string') return null;
    const dele = filename.split('/');
    if (dele.length !== 2 || dele[0] !== mappe) return null;
    const navn = rentFilnavn(dele[1]);
    return navn ? path.join(UPLOAD_DIR, mappe, navn) : null;
}

// Nøglen i en backups files-objekt: 'fil.png' (nye backups) eller '<mappe>/fil.png'
// (ældre backups fra direkte adgang). Giver det rene filnavn, ellers null.
function backupFilnavn(noegle) {
    if (typeof noegle !== 'string') return null;
    const dele = noegle.split('/');
    if (dele.length > 2) return null;
    if (dele.length === 2 && (!SIKKERT_FILNAVN.test(dele[0]) || dele[0].includes('..'))) return null;
    return rentFilnavn(dele[dele.length - 1]);
}

// Gendannelse: sponsor_images-rækkerne peges ind i DENNE klubs mappe, og file_path
// sættes af os. Returnerer en fejltekst, hvis et filnavn er ugyldigt (før noget skrives).
function tilpasSponsorRaekker(raekker, mappe) {
    if (!Array.isArray(raekker)) return null;
    for (const r of raekker) {
        const navn = rentFilnavn(path.posix.basename(String(r.filename || '')));
        if (!navn) return `Ugyldigt filnavn i backup: ${r.filename}`;
        r.filename = `${mappe}/${navn}`;
        if ('file_path' in r) r.file_path = path.join(UPLOAD_DIR, mappe, navn);
    }
    return null;
}

// Backup: klubbens sponsorfiler som base64, nøglet på det rene filnavn
function hentSponsorFiler(raekker, mappe) {
    const filer = {};
    for (const r of raekker || []) {
        const sti = sponsorFilSti(mappe, r.filename);
        if (sti && fs.existsSync(sti)) filer[path.basename(sti)] = fs.readFileSync(sti).toString('base64');
    }
    return filer;
}

// Gendannelse: skriv filerne i klubbens mappe (nøglerne er valideret med backupFilnavn)
function skrivSponsorFiler(filer, mappe) {
    const noegler = Object.keys(filer || {});
    if (!noegler.length) return 0;
    const dir = path.join(UPLOAD_DIR, mappe);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    for (const noegle of noegler) {
        fs.writeFileSync(path.join(dir, backupFilnavn(noegle)), Buffer.from(filer[noegle], 'base64'));
    }
    return noegler.length;
}

module.exports = {
    UPLOAD_DIR,
    klubMappe,
    sponsorFilSti,
    backupFilnavn,
    tilpasSponsorRaekker,
    hentSponsorFiler,
    skrivSponsorFiler
};
