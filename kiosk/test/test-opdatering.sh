#!/bin/bash
# Tester den automatiske opdaterings beslutninger uden en rigtig PC: hvilken
# version der hentes hvornår, at manifestet kun bruges med gyldig signatur,
# og at forsøg tælles, så en version, der ikke virker, opgives.
#
# curl, grub-editenv og timedatectl er falske (svarer fra en mappe og en fil),
# og manifesterne signeres med en testnøgle, der laves her. Selve hentningen
# og skrivningen til disken (klargoer) testes i en virtuel PC — se
# kiosk/test/opdatering-vm.sh.
#
#   bash kiosk/test/test-opdatering.sh

# Variabler som KILDE, ARB og SLOT sættes her og bruges af opdatering-scriptet.
# shellcheck disable=SC2034
set -u
HER=$(cd "$(dirname "$0")" && pwd)
LIB=$HER/../live/config/includes.chroot_after_packages/usr/lib/badminton-tv

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/udgivelser/latest/download"

# ── Falske kommandoer ──────────────────────────────────────
# curl: https://test/releases/<sti> → $TMP/udgivelser/<sti>
cat > "$TMP/bin/curl" <<EOF
#!/bin/bash
ud='' url=''
while [ \$# -gt 0 ]; do
    case "\$1" in
        -o) ud=\$2; shift ;;
        https://*) url=\$1 ;;
    esac
    shift
done
fil="$TMP/udgivelser/\${url#https://test/releases/}"
[ -f "\$fil" ] || exit 22
cp "\$fil" "\$ud"
EOF
# grub-editenv FIL list|set k=v…|unset k… — én nøgle=værdi pr. linje
cat > "$TMP/bin/grub-editenv" <<'EOF'
#!/bin/bash
fil=$1 handling=$2; shift 2
touch "$fil"
case "$handling" in
    list) cat "$fil" ;;
    set)
        for kv in "$@"; do
            grep -v "^${kv%%=*}=" "$fil" > "$fil.ny"; printf '%s\n' "$kv" >> "$fil.ny"; mv "$fil.ny" "$fil"
        done ;;
    unset)
        for k in "$@"; do grep -v "^$k=" "$fil" > "$fil.ny"; mv "$fil.ny" "$fil"; done ;;
esac
EOF
printf '#!/bin/bash\necho "${FAKE_NTP:-yes}"\n' > "$TMP/bin/timedatectl"
chmod +x "$TMP/bin/"*

# Testnøgle — i stedet for Badminton TV's rigtige nøgle
openssl genpkey -algorithm ed25519 -out "$TMP/noegle.pem" 2>/dev/null
openssl pkey -in "$TMP/noegle.pem" -pubout -out "$TMP/noegle.pub"
openssl genpkey -algorithm ed25519 -out "$TMP/fremmed.pem" 2>/dev/null

export PATH="$TMP/bin:$PATH" BT_LIB="$LIB" BT_NOEGLE="$TMP/noegle.pub"
export BT_CONF_INSTALLERET="$TMP/kiosk.conf" BT_CONF_USB="$TMP/ingen.conf" BT_CONF_PI="$TMP/ingen-pi.conf"

# Opdateringsscriptet indlæses som bibliotek (main kører kun ved direkte kald)
# shellcheck source=../live/config/includes.chroot_after_packages/usr/lib/badminton-tv/opdatering
. "$LIB/opdatering"
set +eE
trap - ERR
trap 'rm -rf "$TMP"' EXIT
KILDE=https://test/releases
BTENV=$TMP/badminton-tv.env
ARB=$TMP/arb
# Selve hentningen og skrivningen testes i VM'en — her noteres kun kaldet
klargoer() { echo "KLARGØR $M_VERSION"; saet_proev b; }

ok=0 fejl=0
forvent() { # navn faktisk forventet
    if [ "$2" = "$3" ]; then
        ok=$((ok + 1))
    else
        fejl=$((fejl + 1))
        printf 'FEJL  %s\n      forventet: %s\n      fik:       %s\n' "$1" "$3" "$2"
    fi
}
indeholder() { # navn tekst del
    if [[ "$2" == *"$3"* ]]; then
        ok=$((ok + 1))
    else
        fejl=$((fejl + 1))
        printf 'FEJL  %s\n      forventet tekst med: %s\n      fik: %s\n' "$1" "$3" "$2"
    fi
}

# ── 1. Versioner ───────────────────────────────────────────
er() { if er_nyere "$1" "$2"; then echo ja; else echo nej; fi; }
forvent "2026.10.9 → 2026.10.10 er nyere" "$(er 2026.10.9 2026.10.10)" ja
forvent "2026.10.10 → 2026.9.30 er ikke nyere" "$(er 2026.10.10 2026.9.30)" nej
forvent "samme version er ikke nyere" "$(er 2026.10.9 2026.10.9)" nej
forvent "2026.12.31 → 2027.1.1 er nyere" "$(er 2026.12.31 2027.1.1)" ja
forvent "udviklingsbyg 2026.10.13-dev → udgivelse 2026.10.14" "$(er 2026.10.13-dev 2026.10.14)" ja

# ── 2. Beslutningen ────────────────────────────────────────
NU=1800000000
T=3600
forvent "Samme version" "$(beslut 2026.10.9 2026.10.9 $NU 24 auto $NU '' 0)" nyeste
forvent "Ældre udgivelse: aldrig nedgradering" "$(beslut 2026.10.9 2026.10.8 $NU 24 auto $NU '' 0)" nyeste
forvent "auto venter et døgn" "$(beslut 2026.10.9 2026.10.10 $((NU - 2 * T)) 24 auto $NU '' 0)" "venter $((22 * T))"
forvent "auto efter et døgn" "$(beslut 2026.10.9 2026.10.10 $((NU - 25 * T)) 24 auto $NU '' 0)" hent
forvent "foerst henter med det samme" "$(beslut 2026.10.9 2026.10.10 $NU 24 foerst $NU '' 0)" hent
forvent "vent_timer 0 i manifestet" "$(beslut 2026.10.9 2026.10.10 $NU 0 auto $NU '' 0)" hent
forvent "fra" "$(beslut 2026.10.9 2026.10.10 $NU 0 fra $NU '' 0)" fra
forvent "Allerede klar" "$(beslut 2026.10.9 2026.10.10 $NU 0 auto $NU 2026.10.10 1)" klar
forvent "Klar med en ældre version: hent den nye" "$(beslut 2026.10.9 2026.10.11 $NU 0 auto $NU 2026.10.10 1)" hent
forvent "2 mislykkede forsøg: prøv igen" "$(beslut 2026.10.9 2026.10.10 $NU 0 auto $NU '' 2)" hent
forvent "3 mislykkede forsøg: opgiv" "$(beslut 2026.10.9 2026.10.10 $NU 0 auto $NU '' 3)" opgivet

# ── 3. Manifestet ──────────────────────────────────────────
SHA=$(printf 'a%.0s' {1..64})
manifest() { # version [fil] [sha]
    jq -n --arg v "$1" --arg fil "${2:-badminton-tv-rod-$1.squashfs}" --arg sha "${3:-$SHA}" \
        --argjson udgivet "${UDGIVET:-1800000000}" --argjson vent "${VENT:-24}" \
        '{version: $v, udgivet: $udgivet, vent_timer: $vent, rod: {fil: $fil, sha256: $sha, bytes: 700000000}}'
}
laes() { if laes_manifest "$TMP/m.json"; then echo "$M_VERSION $M_FIL $M_VENT $M_BYTES"; else echo ugyldig; fi; }

manifest 2026.10.10 > "$TMP/m.json"
forvent "Gyldigt manifest" "$(laes)" "2026.10.10 badminton-tv-rod-2026.10.10.squashfs 24 700000000"
manifest 2026.10.10 "../../etc/passwd" > "$TMP/m.json"
forvent "Filnavn med sti afvises" "$(laes)" ugyldig
manifest 2026.10.10 badminton-tv-rod-2026.10.9.squashfs > "$TMP/m.json"
forvent "Filnavn med en anden version afvises" "$(laes)" ugyldig
manifest '2026.10.10; rm -rf /' > "$TMP/m.json"
forvent "Mærkelig version afvises" "$(laes)" ugyldig
manifest 2026.10.10 '' 'ikke-hex' > "$TMP/m.json"
forvent "Ugyldig SHA256 afvises" "$(laes)" ugyldig
printf '{"version": "2026.10.10"}' > "$TMP/m.json"
forvent "Manglende felter afvises" "$(laes)" ugyldig
printf 'ikke json' > "$TMP/m.json"
forvent "Ikke JSON afvises" "$(laes)" ugyldig

# ── 4. tjek: hele forløbet med falske kommandoer ───────────
udgiv() { # version [nøgle] — lægger et signeret manifest som "seneste udgivelse"
    manifest "$1" > "$TMP/udgivelser/latest/download/opdatering.json"
    openssl pkeyutl -sign -inkey "${2:-$TMP/noegle.pem}" -rawin \
        -in "$TMP/udgivelser/latest/download/opdatering.json" \
        -out "$TMP/udgivelser/latest/download/opdatering.json.sig"
}
conf() { printf 'TV_URL=https://a.dk/\nOPDATERING=%s\n' "$1" > "$TMP/kiosk.conf"; }
env_vaerdi() { sed -n "s/^$1=//p" "$BTENV"; }

SLOT=a VERSION_NU=2026.10.9
: > "$BTENV"; env_saet aktiv=a

conf foerst; udgiv 2026.10.9
indeholder "Kører nyeste" "$(tjek)" "Kører den nyeste version (2026.10.9)"

udgiv 2026.10.8
indeholder "Ældre udgivelse (pre-release markeret på GitHub)" "$(tjek)" "Kører den nyeste version"

conf auto; UDGIVET=$(( $(date +%s) - 3 * 3600 )) udgiv 2026.10.10
indeholder "auto: venter på resten af døgnet" "$(tjek)" "Henter den om ca. 21 time(r)"

conf foerst
indeholder "foerst: henter med det samme" "$(tjek)" "KLARGØR 2026.10.10"
forvent "proev sat til B" "$(env_vaerdi proev)" b
forvent "proev_version" "$(env_vaerdi proev_version)" 2026.10.10
forvent "forsøg 1" "$(env_vaerdi proev_antal)" 1
indeholder "Klar: hentes ikke igen" "$(tjek)" "er klar og startes ved næste opstart"

# GRUB har startet B på prøve (og slettet proev), men B blev ikke godkendt —
# PC'en kører A igen
env_saet proev=
indeholder "Mislykket forsøg: prøv igen" "$(tjek)" "KLARGØR 2026.10.10"
forvent "forsøg 2" "$(env_vaerdi proev_antal)" 2
env_saet proev=; tjek >/dev/null
env_saet proev=
indeholder "Efter 3 forsøg: opgiv" "$(tjek)" "prøvet 3 gange uden at virke"

udgiv 2026.10.11
indeholder "Ny version efter en opgivet" "$(tjek)" "KLARGØR 2026.10.11"
forvent "Tælleren starter forfra" "$(env_vaerdi proev_antal)" 1

: > "$BTENV"; env_saet aktiv=a
udgiv 2026.10.12 "$TMP/fremmed.pem"
svar=$(tjek); kode=$?
indeholder "Forkert nøgle afvises" "$svar" "signatur passer ikke"
forvent "Forkert nøgle: fejlkode" "$kode" 1
forvent "Forkert nøgle: intet klargjort" "$(env_vaerdi proev)" ""

udgiv 2026.10.12
printf ' ' >> "$TMP/udgivelser/latest/download/opdatering.json"
indeholder "Ændret manifest afvises" "$(tjek)" "signatur passer ikke"

rm -f "$TMP/udgivelser/latest/download/opdatering.json"*
indeholder "Ingen forbindelse / ingen manifest" "$(tjek)" "Kunne ikke hente opdateringsmanifestet"

udgiv 2026.10.12
conf fra
indeholder "OPDATERING=fra" "$(tjek)" "slået fra"
conf foerst
indeholder "Uret er ikke sat" "$(FAKE_NTP=no tjek)" "Uret er ikke sat"

SLOT=b
indeholder "Ny version på prøve: tjekker ikke" "$(tjek)" "kører på prøve"
SLOT=''
indeholder "Gammelt disklayout" "$(tjek)" "det gamle disklayout"

echo "$ok bestået, $fejl fejlet"
[ "$fejl" -eq 0 ]
