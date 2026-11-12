// Hvilke subdomæner en klub må få, og hvilke databaser "Slet klub" aldrig må røre.
//
// En klubs database hedder som subdomænet med _ for - (aarhus-badminton →
// aarhus_badminton). Før blev navnet ikke tjekket: en klub oprettet som
// "badminton-master" fik master-databasen som sin egen (CREATE DATABASE IF NOT
// EXISTS, og klubbens skema kørt oven i den), og "Slet klub" droppede den
// bagefter — med alle klubber, admins og indstillinger.
//
// Navnet bruges også som klubbens mappe i uploads/ og club-backups/ og som
// nøgle i fælles tabeller, så "local", "direct" og "central-logos" er også
// optaget: de er demoens mappe, demoens nøgle og mappen med de fælles logoer.

// Databaser, der ikke er en klubs: MySQL's egne, master, demoen (DB_NAME) og football
const systemDatabaser = () => new Set([
    'mysql', 'sys', 'information_schema', 'performance_schema',
    'badminton_master', 'football_tournament',
    (process.env.DB_NAME || 'badminton_counter').toLowerCase()
]);

// Subdomæner med en anden betydning: adresser, serveren selv bruger
// (middleware/tenant.js og nginx.conf), og navne, der er optaget som mappe/nøgle
const RESERVEREDE = new Set([
    'app', 'api', 'admin', 'www', 'mail', 'smtp', 'ftp', 'statistik', 'planner', 'live',
    'localhost', 'local', 'direct', 'central-logos', 'backup', 'backups', 'uploads',
    // Navne, der har en særlig betydning for Node's EventEmitter (nr. 95). Nøglerne
    // har præfiks nu, men en klub med de navne giver kun forvirring i logs og kode
    'error', 'newlistener', 'removelistener'
]);

// Et DNS-navn: små bogstaver, tal og bindestreg, ikke bindestreg først eller sidst
const GYLDIGT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const dbNavn = (subdomain) => String(subdomain).replace(/-/g, '_');

const erBeskyttetDatabase = (db) => !db || systemDatabaser().has(String(db).toLowerCase());

// Fejltekst, hvis subdomænet ikke kan bruges til en ny klub; ellers null
function validerSubdomain(subdomain) {
    if (typeof subdomain !== 'string' || !GYLDIGT.test(subdomain)) {
        return 'Subdomain må kun indeholde små bogstaver, tal og bindestreger (højst 63 tegn, ikke bindestreg først eller sidst)';
    }
    if (RESERVEREDE.has(subdomain) || erBeskyttetDatabase(dbNavn(subdomain))) {
        return `Subdomain '${subdomain}' er reserveret — vælg et andet`;
    }
    return null;
}

module.exports = { validerSubdomain, dbNavn, erBeskyttetDatabase, RESERVEREDE };
