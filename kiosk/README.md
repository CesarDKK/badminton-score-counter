# Badminton TV — USB-nøgle til TV-skærme i hallen

En USB-nøgle, der laver en almindelig PC om til en TV-skærm. PC'en starter
direkte op i fuld skærm på én side fra appen, går aldrig i dvale og slukker
selv kl. 23:59, hvis ingen har slukket den. Det eneste, man skal rette, er
`kiosk.conf` på nøglen.

Bygget og testet til **Lenovo ThinkCentre M920x**, men virker på de fleste
UEFI-PC'er fra de sidste ti år.

---

## Til dem der sætter skærmene op

### Lav USB-nøglen

Hent den nyeste release under
[Releases](https://github.com/CesarDKK/badminton-score-counter/releases)
(filer der starter med `badminton-tv-usb-`). Der er to måder:

| Metode | Hvornår |
|---|---|
| **`.zip`** — formatér nøglen som FAT32 i Windows og pak zip-filen ud direkte på den | Nøgler op til 32 GB (Windows kan ikke formatere større nøgler som FAT32) |
| **`.img`** — skriv den med [balenaEtcher](https://etcher.balena.io/) eller Rufus | Alle størrelser |

Begge veje ender med et almindeligt drev i Windows, hvor `kiosk.conf` og
`VEJLEDNING.txt` ligger.

### Ret kiosk.conf

Åbn `kiosk.conf` i Notesblok:

```ini
TV_URL=https://lyngby.badmintonapp.dk/t/AbC123xyz
WIFI_NAVN=Hallens WiFi
WIFI_KODE=hemmelig
NAVN=tv-bane1
SLUK_KL=23:59
```

**Brug et adgangslink (`/t/…`) fra admin-siden som `TV_URL`.** Så skiftes bane
og QR-kode fra admin-siden, og PC'en skal aldrig røres igen. Adgangslinket
fornyer selv sin session ved hver opstart.

Filen tåler det, Notesblok laver: Windows-linjeskift, ANSI eller UTF-8, æøå,
`&` og `#` i adressen. Fejl vises på skærmen, **før** noget bliver slettet.

### Installér

1. Sæt nøglen i PC'en, tænd den, og tryk gentagne gange på **F12** (Lenovo).
   Vælg USB-nøglen.
2. Vælg **Installer Badminton TV**, eller vent 10 sekunder.
3. Skærmen viser, hvilken disk der slettes, og tæller **15 sekunder** ned.
   Et tastetryk afbryder.
4. Efter 3–5 minutter: **"Fjern USB-nøglen nu"**. PC'en genstarter, når
   nøglen er taget ud, og viser TV-siden.

Installationen kræver ikke internet. Den samme nøgle kan bruges til flere
PC'er — ret bare `kiosk.conf` imellem. Efter hver installation ligger der en
`installation-log.txt` på nøglen.

**Test først:** *Test uden at installere* i startmenuen kører TV-siden direkte
fra nøglen uden at røre disken. Den viser først en oversigt med netværk,
skærmopløsning og om HDMI-CEC virker på netop den PC og det kabel.
Prøvetilstanden slukker ikke automatisk — det gør kun den installerede PC.
Efter 1, 3 og 6 minutter skriver den `diagnose.txt` på nøglen: netværkskort,
driver, synlige WiFi-netværk med sikkerhedstype og NetworkManagers log.
WiFi-koden kommer ikke med — kun dens længde og om den har mellemrum.

### Daglig brug

- **Tænd** på knappen — TV-siden vises efter ca. 20 sekunder.
- **Sluk** med et kort tryk på knappen. PC'en lukker pænt ned.
- Er den ikke slukket kl. `SLUK_KL`, slukker den selv. Lige før installeres
  sikkerhedsopdateringer — så sker det aldrig midt i en kamp.
- Mister den netværket ved opstart, viser den "Venter på forbindelse…" og
  prøver igen, i stedet for en fejlside.

### TV'et og HDMI-CEC

De fleste PC'er kan **ikke** tænde og slukke TV'et. Grafikkortet har ikke
HDMI-CEC forbundet. M920x har DisplayPort, og et almindeligt passivt
DP→HDMI-kabel sender ikke CEC videre.

Systemet prøver automatisk og bruger CEC, hvis Linux finder det. Ellers:

- **Tænd TV'et** med fjernbetjeningen.
- **Sluk:** De fleste TV'er kan selv gå i standby, når signalet forsvinder. Slå
  det til i TV'ets menu — det hedder fx *Sluk ved intet signal*, *Auto Power
  Off* eller *No Signal Power Off*.

### Ting der kan drille

| Symptom | Løsning |
|---|---|
| PC'en vil ikke starte fra nøglen | Slå *Secure Boot* fra i BIOS (F1 ved opstart på Lenovo) |
| "PC'en har flere diske" | Skriv den rigtige i `kiosk.conf`, fx `DISK=/dev/nvme0n1` |
| Venter på forbindelse i lang tid | Skærmen viser årsagen (forkert kode, netværket kan ikke ses, intet WiFi-kort …). Kun WPA2/WPA3 med adgangskode — ikke netværk med login-side eller brugernavn. Kør *Test uden at installere* i 6 minutter og se `diagnose.txt` på nøglen |
| Teksten er for lille/stor | `SKALERING=1.5` (eller et andet tal) i `kiosk.conf`, og installér igen |
| Uret er forkert første gang | Retter sig, når PC'en har været på nettet. Indtil da springes den automatiske slukning over |

---

## Til udviklere

### Opbygning

```
kiosk/
├── build.sh                 bygger zip + img (kører i debian:trixie-container)
├── usb/                     filer der lægges direkte på USB-nøglen
│   ├── kiosk.conf           skabelon (får BOM + CRLF i buildet)
│   ├── VEJLEDNING.txt
│   └── boot/grub/grub.cfg   startmenuen
├── live/                    live-build-konfiguration
│   ├── auto/config
│   └── config/
│       ├── package-lists/   pakkerne
│       ├── hooks/normal/    bruger, tidszone, aktivering af services
│       └── includes.chroot_after_packages/   vores filer i systemet
└── test/
    ├── test-conf.sh         tests af kiosk.conf-læsningen
    └── vm.sh                kør hele forløbet i en virtuel UEFI-PC
```

**Idé:** USB-nøglen er et Debian 13 live-system, og **det samme system** er
det, der ender på disken. Installationen kopierer live-systemets filer over
med rsync, fjerner live-pakkerne og installerer GRUB. Der er ingen
Debian-installer, ingen netværksinstallation og intet preseed.

| Del | Fil |
|---|---|
| Læsning af `kiosk.conf` (fælles) | `usr/lib/badminton-tv/conf.sh` |
| Værtsnavn + WiFi ved opstart | `usr/lib/badminton-tv/setup` |
| Chromium i fuldskærm under `cage` | `usr/lib/badminton-tv/browser` |
| Venter på netværk, viser fejl/diagnose | `usr/share/badminton-tv/start.html` |
| Netværksstatus til skærmen (`status.js`) | `usr/lib/badminton-tv/netstatus` |
| `diagnose.txt` på nøglen i prøvetilstand | `usr/lib/badminton-tv/diagnose` |
| HDMI-CEC (`cec-ctl`) | `usr/lib/badminton-tv/cec` |
| Automatisk slukning + opdateringer | `usr/lib/badminton-tv/sluk` + generator |
| Installation på disk | `usr/lib/badminton-tv/installer` |

Tilstanden vælges med boot-parameteren `badminton.tilstand=installer|proeve`.
Uden parameteren (den installerede PC) er det normal drift.

### Byg lokalt

```bash
docker run --rm --privileged -v "$PWD/kiosk:/src" -v "$PWD/kiosk/ud:/ud" debian:trixie bash /src/build.sh
```

Første build tager 15–30 minutter. Med `-e GENBRUG_ISO=1` genbruges
live-systemet, hvis du kun har ændret filerne i `usb/`. Det kræver, at
containeren ikke blev fjernet, så brug en navngivet container i stedet for
`--rm`.

### Test i en virtuel PC

```bash
docker run -d --name bt-vm -v "$PWD/kiosk:/src" -v "$PWD/kiosk/ud:/ud" debian:trixie sleep infinity
docker exec bt-vm bash /src/test/vm.sh start /ud/badminton-tv-usb-<version>.img
docker exec bt-vm bash /src/test/vm.sh skaerm /ud/skaerm.png
docker exec bt-vm bash /src/test/vm.sh fjern-usb
docker exec bt-vm bash /src/test/vm.sh genstart-fra-disk
```

`--secure-boot` efter billedet tester med Microsofts nøgler, som på en rigtig
PC. `--proeve` gør *Test uden at installere* til menuens standardvalg — et
tastetryk sendt gennem QEMU når ikke altid frem i tide. Uden KVM (Docker
Desktop på Windows) emuleres CPU'en. Det tager et par minutter pr. opstart,
men hele forløbet kan testes undtagen WiFi og CEC.

Den installerede PC's journal overlever i disk-billedet. Se kommentaren
øverst i `vm.sh` for, hvordan den læses bagefter.

### Release

GitHub Actions (`.github/workflows/tv-usb.yml`) bygger ved hvert push, der
rører `kiosk/`, og gemmer resultatet som artefakt i 7 dage. En release laves
med et tag:

```bash
git tag tv-usb-v2026.10.1
```

```bash
git push origin tv-usb-v2026.10.1
```
