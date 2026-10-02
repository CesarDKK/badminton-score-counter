# shellcheck shell=bash
# Fælles læsning af kiosk.conf — sources af de øvrige Badminton TV-scripts.
#
# Filen bliver redigeret i Notesblok på Windows, så den kan have CRLF-linjeskift,
# UTF-8-BOM, være gemt som ANSI (cp1252) eller UTF-16. Den læses linje for linje
# som NØGLE=værdi og køres aldrig som shell: en URL med & eller $ er bare tekst.
#
# Efter bt_read_conf er BT_*-variablerne sat og normaliseret, BT_FEJL indeholder
# fejl der forhindrer visning (én pr. linje), og BT_ADVARSLER indeholder ting der
# er værd at nævne, men som ikke stopper noget.

BT_CONF_PI=${BT_CONF_PI:-/boot/firmware/kiosk.conf}
BT_CONF_INSTALLERET=${BT_CONF_INSTALLERET:-/etc/badminton-tv/kiosk.conf}
BT_CONF_USB=${BT_CONF_USB:-/run/live/medium/kiosk.conf}

# Udskriver stien til den kiosk.conf der gælder. På en Raspberry Pi ligger den
# på SD-kortets FAT-partition, så den kan rettes på en Windows-PC. På den
# installerede PC ligger den i /etc; i prøvetilstand læses den fra USB-nøglen.
bt_find_conf() {
    local f
    for f in "$BT_CONF_PI" "$BT_CONF_INSTALLERET" "$BT_CONF_USB"; do
        if [ -f "$f" ]; then
            printf '%s\n' "$f"
            return 0
        fi
    done
    return 1
}

# Udskriver filen som UTF-8 med LF-linjeskift og uden BOM.
bt_normaliser_conf() {
    local fil=$1 bom
    bom=$(head -c 2 "$fil" | od -An -tx1 | tr -d ' \n')
    if [ "$bom" = "fffe" ] || [ "$bom" = "feff" ]; then
        iconv -f UTF-16 -t UTF-8 "$fil"
    elif iconv -f UTF-8 -t UTF-8 "$fil" >/dev/null 2>&1; then
        cat "$fil"
    else
        iconv -f CP1252 -t UTF-8 "$fil"
    fi | sed '1s/^\xEF\xBB\xBF//; s/\r$//'
}

_bt_trim() {
    local s=$1
    s=${s#"${s%%[![:space:]]*}"}
    s=${s%"${s##*[![:space:]]}"}
    printf '%s' "$s"
}

bt_read_conf() {
    local fil=$1 linje noegle vaerdi

    BT_TV_URL='' BT_NAVN='' BT_WIFI_NAVN='' BT_WIFI_KODE='' BT_SLUK_KL=''
    BT_CEC='' BT_SKALERING='' BT_DISK=''
    BT_FEJL='' BT_ADVARSLER=''

    while IFS= read -r linje || [ -n "$linje" ]; do
        linje=$(_bt_trim "$linje")
        case "$linje" in ''|'#'*|';'*) continue ;; esac
        if [[ "$linje" != *=* ]]; then
            BT_ADVARSLER+="Linjen \"$linje\" mangler et lighedstegn og blev ignoreret."$'\n'
            continue
        fi

        noegle=$(_bt_trim "${linje%%=*}")
        vaerdi=$(_bt_trim "${linje#*=}")
        # Anførselstegn omkring værdien er tilladt (og nødvendige hvis en
        # WiFi-kode starter eller slutter med mellemrum).
        if [ ${#vaerdi} -ge 2 ]; then
            case "$vaerdi" in
                \"*\"|\'*\') vaerdi=${vaerdi:1:${#vaerdi}-2} ;;
            esac
        fi

        case "${noegle^^}" in
            TV_URL)     BT_TV_URL=$vaerdi ;;
            NAVN)       BT_NAVN=$vaerdi ;;
            WIFI_NAVN)  BT_WIFI_NAVN=$vaerdi ;;
            WIFI_KODE)  BT_WIFI_KODE=$vaerdi ;;
            SLUK_KL)    BT_SLUK_KL=$vaerdi ;;
            CEC)        BT_CEC=$vaerdi ;;
            SKALERING)  BT_SKALERING=$vaerdi ;;
            DISK)       BT_DISK=$vaerdi ;;
            *) BT_ADVARSLER+="Ukendt indstilling \"$noegle\" blev ignoreret (stavefejl?)."$'\n' ;;
        esac
    done < <(bt_normaliser_conf "$fil")

    _bt_valider
}

_bt_valider() {
    # TV_URL
    if [ -z "$BT_TV_URL" ]; then
        BT_FEJL+="TV_URL er ikke udfyldt."$'\n'
    elif ! [[ "$BT_TV_URL" =~ ^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$ ]]; then
        BT_FEJL+="TV_URL skal starte med http:// eller https:// og må ikke indeholde mellemrum."$'\n'
    fi

    # NAVN → gyldigt værtsnavn. Danske bogstaver skrives om i stedet for at fejle.
    # Store og små æøå skrives om hver for sig og uden [..]-mønstre: uden dansk
    # locale kender ${,,} kun ASCII, og [æÆ] bliver et sæt af enkelte bytes.
    local navn=$BT_NAVN
    navn=${navn//æ/ae}; navn=${navn//Æ/ae}
    navn=${navn//ø/oe}; navn=${navn//Ø/oe}
    navn=${navn//å/aa}; navn=${navn//Å/aa}
    navn=$(printf '%s' "$navn" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//')
    navn=${navn:0:63}
    navn=${navn%-}
    BT_NAVN=${navn:-badminton-tv}

    # WiFi
    if [ -n "$BT_WIFI_NAVN" ]; then
        if [ "$(printf '%s' "$BT_WIFI_NAVN" | wc -c)" -gt 32 ]; then
            BT_FEJL+="WIFI_NAVN er for langt (højst 32 tegn)."$'\n'
        fi
        if [ -n "$BT_WIFI_KODE" ]; then
            local laengde
            laengde=$(printf '%s' "$BT_WIFI_KODE" | wc -c)
            if ! { [ "$laengde" -ge 8 ] && [ "$laengde" -le 63 ]; } \
               && ! [[ "$BT_WIFI_KODE" =~ ^[0-9A-Fa-f]{64}$ ]]; then
                BT_FEJL+="WIFI_KODE skal være mellem 8 og 63 tegn."$'\n'
            fi
        fi
    elif [ -n "$BT_WIFI_KODE" ]; then
        BT_ADVARSLER+="WIFI_KODE er udfyldt, men WIFI_NAVN er tom — WiFi bliver ikke sat op."$'\n'
    fi

    # SLUK_KL — danskere skriver ofte 23.59, så punktum accepteres også.
    local sluk=${BT_SLUK_KL,,}
    sluk=${sluk//./:}
    case "$sluk" in
        '') BT_SLUK_KL=23:59 ;;
        aldrig|nej|fra|ingen) BT_SLUK_KL=aldrig ;;
        *)
            if [[ "$sluk" =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]]; then
                printf -v BT_SLUK_KL '%02d:%s' "$((10#${BASH_REMATCH[1]}))" "${BASH_REMATCH[2]}"
            else
                BT_ADVARSLER+="SLUK_KL \"$BT_SLUK_KL\" er ikke et klokkeslæt (TT:MM) — bruger 23:59."$'\n'
                BT_SLUK_KL=23:59
            fi
            ;;
    esac

    # CEC
    case "${BT_CEC,,}" in
        ''|auto|ja|til) BT_CEC=auto ;;
        nej|fra) BT_CEC=fra ;;
        *) BT_ADVARSLER+="CEC \"$BT_CEC\" forstås ikke — bruger auto."$'\n'; BT_CEC=auto ;;
    esac

    # SKALERING
    local skala=${BT_SKALERING,,}
    skala=${skala//,/.}
    if [ -z "$skala" ] || [ "$skala" = auto ]; then
        BT_SKALERING=auto
    elif [[ "$skala" =~ ^[0-9]+(\.[0-9]+)?$ ]] \
         && awk -v s="$skala" 'BEGIN { exit !(s >= 0.5 && s <= 4) }'; then
        BT_SKALERING=$skala
    else
        BT_ADVARSLER+="SKALERING \"$BT_SKALERING\" skal være auto eller et tal mellem 0.5 og 4 — bruger auto."$'\n'
        BT_SKALERING=auto
    fi

    # DISK
    if [ -n "$BT_DISK" ] && ! [[ "$BT_DISK" =~ ^/dev/[A-Za-z0-9/_-]+$ ]]; then
        BT_FEJL+="DISK skal være en sti som /dev/nvme0n1 eller /dev/sda."$'\n'
    fi

    BT_FEJL=${BT_FEJL%$'\n'}
    BT_ADVARSLER=${BT_ADVARSLER%$'\n'}
}
