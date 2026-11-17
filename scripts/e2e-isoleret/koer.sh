#!/bin/sh
# E2E-containeren (scripts/e2e-isoleret/compose.yml): alpine's chromium + playwright,
# admin-token via standardlogin (direct-mode, admin123 — kun i den isolerede database).
apk add -q chromium nss freetype harfbuzz ttf-freefont || exit 1
mkdir -p /tmp/pw && cd /tmp/pw && npm i -s playwright >/dev/null 2>&1 || exit 1
cd /repo
BT_TOKEN=$(node -e "fetch('http://localhost:8080/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'admin123'})}).then(r=>r.json()).then(j=>console.log(j.token))")
export BT_TOKEN
SCRIPT="scripts/${E2E_SCRIPT:-taeller-e2e.js}"
# E2E_PAUSE=1: afsnit 2 genindlæser siden 15 ms efter et point, og tablettens
# pagehide-flush når ikke frem før den nye sides GET — det sidste point mangler.
# En kopi med 400 ms pause før genindlæsningen lader afsnit 3–5 køre.
if [ "$E2E_PAUSE" = "1" ]; then
    node -e "
const fs = require('fs');
const t = fs.readFileSync('$SCRIPT', 'utf8');
const ny = t.replace(/^(    const foerReload = await sig\(\);)/m, '\$1 await sov(400);');
if (ny === t) { console.error('E2E_PAUSE: genindlæsningen i afsnit 2 blev ikke fundet'); process.exit(1); }
fs.writeFileSync('/tmp/e2e-pause.js', ny);
" || exit 1
    echo "E2E_PAUSE=1: kører en kopi med 400 ms pause før genindlæsningen i afsnit 2"
    SCRIPT=/tmp/e2e-pause.js
fi
node "$SCRIPT"
