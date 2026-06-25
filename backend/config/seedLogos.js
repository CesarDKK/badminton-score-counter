const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query, queryOne } = require('./masterDatabase');

// Mappen med bundtede standard-logoer (bages ind i imaget via COPY backend/ ./)
const SEED_DIR = path.join(__dirname, '..', 'assets', 'seed_logos');
// Samme placering som logoUpload.js skriver til (Docker uploads-volume)
const baseUploadDir = process.env.UPLOAD_DIR || './uploads';
const logoDir = path.join(baseUploadDir, 'central_logos');

// Seeder standard klub-logoer idempotent. Re-sync: manglende logoer gen-indsaettes
// ved hver opstart. Springer over hvis seed_key allerede findes (bevarer admins
// redigeringer) eller hvis club_name allerede findes (undgaar dublet mod manuelt upload).
async function seedClubLogos() {
    if (!fs.existsSync(SEED_DIR)) {
        console.warn('⚠ Seed-mappe ikke fundet, springer logo-seed over:', SEED_DIR);
        return { seeded: 0, skipped: 0 };
    }
    if (!fs.existsSync(logoDir)) {
        fs.mkdirSync(logoDir, { recursive: true });
    }

    const files = fs.readdirSync(SEED_DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
    const mimeFor = (ext) => ext === '.webp' ? 'image/webp' : (ext === '.png' ? 'image/png' : 'image/jpeg');

    // Valgfri alias-manifest fra eksport (aliases.json springes selv over af filteret ovenfor).
    let aliasesByFile = {};
    const manifestPath = path.join(SEED_DIR, 'aliases.json');
    if (fs.existsSync(manifestPath)) {
        try { aliasesByFile = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) || {}; }
        catch (e) { console.error('Kunne ikke laese aliases.json:', e.message); aliasesByFile = {}; }
    }
    let seeded = 0, skipped = 0;

    for (const file of files) {
        try {
            const seedKey = file;
            // Manifesten kan baere {club_name, aliases} (nyt format, bevarer navne med /)
            // eller bare en alias-streng (gammelt format). Klubnavn falder tilbage til filnavnet.
            const manifestVal = aliasesByFile[file];
            let manClub = null, rawAlias = null;
            if (manifestVal && typeof manifestVal === 'object' && !Array.isArray(manifestVal)) {
                manClub = manifestVal.club_name;
                rawAlias = manifestVal.aliases;
            } else {
                rawAlias = manifestVal;
            }
            const clubName = ((manClub !== undefined && manClub !== null && String(manClub).trim())
                ? String(manClub)
                : path.basename(file, path.extname(file)))
                .replace(/\s+/g, ' ')
                .trim();
            const aliases = (rawAlias === undefined || rawAlias === null || rawAlias === '')
                ? null
                : (Array.isArray(rawAlias) ? rawAlias.join(', ') : String(rawAlias));

            // Allerede seeded (evt. redigeret af admin) -> bevar
            const bySeed = await queryOne(
                'SELECT id FROM club_logos WHERE seed_key = ?', [seedKey]
            );
            if (bySeed) { skipped++; continue; }

            // Manuelt upload med samme navn -> undgaa dublet
            const byName = await queryOne(
                'SELECT id FROM club_logos WHERE club_name = ?', [clubName]
            );
            if (byName) { skipped++; continue; }

            const ext = path.extname(file).toLowerCase();
            const slug = clubName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            const storedName = `seed_${slug}${ext}`;
            const srcPath = path.join(SEED_DIR, file);
            const destPath = path.join(logoDir, storedName);
            fs.copyFileSync(srcPath, destPath);

            let width = null, height = null;
            try {
                const meta = await sharp(destPath).metadata();
                width = meta.width || null;
                height = meta.height || null;
            } catch (e) { /* metadata valgfri */ }

            const fileSize = fs.statSync(destPath).size;

            await query(
                `INSERT INTO club_logos
                 (club_name, aliases, filename, original_name, file_path, file_size,
                  width, height, mime_type, seed_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [clubName, aliases, `central_logos/${storedName}`, file, destPath,
                 fileSize, width, height, mimeFor(ext), seedKey]
            );
            seeded++;
        } catch (e) {
            console.error(`✗ Kunne ikke seede logo "${file}":`, e.message);
        }
    }

    console.log(`✓ Logo-seed: ${seeded} tilfoejet, ${skipped} sprunget over (${files.length} filer)`);
    return { seeded, skipped };
}

module.exports = { seedClubLogos };
