// Quick CLI til at oprette en football-klub + admin før super-admin UI er på plads (Phase 2).
//
// Brug:
//   docker-compose exec football-backend node scripts/seedClub.js <subdomain> <klubnavn> <username> <password>
// Eksempel:
//   docker-compose exec football-backend node scripts/seedClub.js test 'Test FC' admin admin123
//
// Hvis klubben allerede findes opdateres ikke noget; admin'en opdateres med ny password-hash hvis username matcher.

const bcrypt = require('bcryptjs');
const { pool } = require('../db');

async function main() {
  const [subdomain, name, username, password] = process.argv.slice(2);
  if (!subdomain || !name || !username || !password) {
    console.error('Usage: node scripts/seedClub.js <subdomain> <klubnavn> <username> <password>');
    process.exit(1);
  }

  try {
    // 1) Opret klub hvis den ikke findes
    const [existing] = await pool.query(
      'SELECT id FROM football_clubs WHERE subdomain = ? LIMIT 1',
      [subdomain]
    );
    let clubId;
    if (existing.length > 0) {
      clubId = existing[0].id;
      console.log(`Klub '${subdomain}' findes allerede (id=${clubId}) — genbruger.`);
    } else {
      const [result] = await pool.query(
        'INSERT INTO football_clubs (subdomain, name) VALUES (?, ?)',
        [subdomain, name]
      );
      clubId = result.insertId;
      console.log(`✓ Oprettet klub '${name}' (subdomain=${subdomain}, id=${clubId})`);
    }

    // 2) Opret/opdater admin
    const hash = await bcrypt.hash(password, 10);
    const [adminExisting] = await pool.query(
      'SELECT id FROM football_club_admins WHERE club_id = ? AND username = ? LIMIT 1',
      [clubId, username]
    );
    if (adminExisting.length > 0) {
      await pool.query(
        'UPDATE football_club_admins SET password_hash = ? WHERE id = ?',
        [hash, adminExisting[0].id]
      );
      console.log(`✓ Opdateret password for admin '${username}'`);
    } else {
      await pool.query(
        'INSERT INTO football_club_admins (club_id, username, password_hash) VALUES (?, ?, ?)',
        [clubId, username, hash]
      );
      console.log(`✓ Oprettet admin '${username}' for klub '${subdomain}'`);
    }

    console.log('');
    console.log(`Login med:`);
    console.log(`  URL:       https://${subdomain}.footballapp.dk/login.html`);
    console.log(`  Username:  ${username}`);
    console.log(`  Password:  ${password}`);

    await pool.end();
  } catch (err) {
    console.error('Fejl:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();
