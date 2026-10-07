# Badminton TV — USB-nøgle til TV-skærme i hallen

En USB-nøgle, der laver en almindelig PC om til en TV-skærm. PC'en starter
direkte op i fuld skærm på én side fra appen, går aldrig i dvale og slukker
selv kl. 23:59, hvis ingen har slukket den. Det eneste, man skal rette, er
`kiosk.conf` på nøglen.

Bygget og testet til **Lenovo ThinkCentre M920x**, men virker på de fleste
UEFI-PC'er fra de sidste ti år.

Der findes også et **SD-kort-billede til Raspberry Pi 3, 4 og 5** med samme
skærm og samme `kiosk.conf` — se [Raspberry Pi](#raspberry-pi) nedenfor.

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
3. Skærmen viser, hvilken disk der slettes, og tæller **15 sekunder** ned —
   også uden tastatur. Et tastetryk, at tage nøglen ud eller at slukke PC'en
   afbryder.

Er PC'ens UEFI-lager (NVRAM) fuldt, kan boot-posten ikke gemmes. Så
installeres der uden den, og PC'en starter fra disken via standardstien
`\EFI\BOOT\BOOTX64.EFI`. Skærmen og `installation-log.txt` siger det.
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
- **Tænd automatisk:** sæt en opstartstid i BIOS (*Wake on alarm* el.lign.).
  PC'ens BIOS-ur kører dansk tid (fra 2026.10.8), så kl. 8 i BIOS er kl. 8.
  Natten efter et skift til/fra sommertid kan den ene opstart ligge en time
  forkert; uret rettes, så snart PC'en har været på nettet.
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
| "WiFi-kortet svarer ikke" — selvom WiFi virkede under Windows | Sluk PC'en, **træk strømstikket ud i 1 minut**, og tænd igen. Windows kan efterlade kortet i en strømsparetilstand, og M.2-kortet har strøm, selv når PC'en er slukket — derfor hjælper en genstart ikke. Set på M920x med Intel AC 8265 |
| PC'en vil ikke starte fra nøglen | Slå *Secure Boot* fra i BIOS (F1 ved opstart på Lenovo) |
| "PC'en har flere diske" | Skriv den rigtige i `kiosk.conf`, fx `DISK=/dev/nvme0n1` |
| Venter på forbindelse i lang tid | Skærmen viser årsagen (forkert kode, netværket kan ikke ses, intet WiFi-kort …). Kun WPA2/WPA3 med adgangskode — ikke netværk med login-side eller brugernavn. Kør *Test uden at installere* i 6 minutter og se `diagnose.txt` på nøglen |
| Teksten er for lille/stor | `SKALERING=1.5` (eller et andet tal) i `kiosk.conf`, og installér igen |
| Uret er forkert første gang | Retter sig, når PC'en har været på nettet. Indtil da springes den automatiske slukning over |
| PC'en stod frosset hele natten med en ensfarvet skærm uden logo | Disken holdt op med at svare (set på M70q med Micron-NVMe, 2026-10-06). Kernen kører videre, så hardware-vagthunden hjælper ikke, men intet kan skrives, og slukningen kl. `SLUK_KL` sker aldrig. Fra 2026.10.7 genstarter PC'en selv: straks når disken melder fejl, og efter 2–4 minutter hvis den bare hænger. *Hent fejllog* viser diskfejlene under *Kernenedbrud*. NVMe-diskens dybe strømsparetilstande er samtidig slået fra |

### Raspberry Pi

Hent `badminton-tv-pi-<version>.img.xz` fra samme release, og skriv den til
et SD-kort på mindst 8 GB med [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
(*Use custom*, og sig nej til OS-tilpasning) eller balenaEtcher. Kortet dukker
op som drevet `bootfs` i Windows — ret `kiosk.conf` dér, sæt kortet i Pi'en og
tilslut strøm. Der er ingen installation: SD-kortet *er* Pi'ens disk.

Forskelle fra PC'en:

- **Pi 4 eller 5 anbefales.** Pi 3 virker, men er langsom — kun som reserve.
  Samme billede passer til alle tre.
- **`kiosk.conf` kan rettes bagefter**: sluk, tag kortet ud, ret filen på en
  PC, sæt kortet i igen.
- **HDMI-CEC virker** på Pi'en, når det er slået til i TV'et. Pi 4: brug
  HDMI-porten nærmest strømstikket.
- **Slukning kl. 23:59**: en Pi 5 tændes igen med knappen; Pi 3 og 4 har ingen
  knap og skal have strømmen fjernet og sat i igen.
- **`diagnose.txt`** skrives på SD-kortet ved hver opstart (efter 1, 3 og 6
  minutter).
- **Skærmen låses til 1080p**, også på et 4K-TV — en Pi 3/4 har ikke kræfter
  til mere.
- Loggen ligger kun i RAM, så SD-kortet ikke slides.

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
├── pi/                      Raspberry Pi-udgaven
│   ├── build-pi.sh          tilpasser Raspberry Pi OS Lite → img.xz
│   ├── tilpas.sh            kører inde i Pi-billedet (pakker, bruger, services)
│   ├── rootfs/              Pi-specifikke filer (diagnose, journal, opdateringer)
│   └── VEJLEDNING.txt       lægges på SD-kortet
└── test/
    ├── test-conf.sh         tests af kiosk.conf-læsningen
    ├── test-netstatus.sh    tests af netværksvurderingen
    └── vm.sh                kør hele forløbet i en virtuel UEFI-PC
```

**Raspberry Pi:** `build-pi.sh` tager det officielle Raspberry Pi OS Lite
(64-bit, trixie — URL og tjeksum er låst i scriptet), gør plads,
kopierer de fælles filer fra `live/config/includes.chroot_after_packages/`
ind (minus installeren og GRUB), lægger `pi/rootfs/` ovenpå og kører
`tilpas.sh` i chroot. Raspberry Pi OS' førstegangsopsætning (`userconfig`,
`systemd-firstboot`, `cloud-init`) slås fra, så intet venter på et tastatur.

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

Raspberry Pi-billedet bygges i en almindelig container. Kun programmerne inde
i Pi-billedet skal køre som ARM64, og det emulerer Docker Desktop selv —
langsomt, men kun for installationen af pakkerne. GitHub Actions bygger det på
en ARM-runner uden emulering. Brug ikke `--platform linux/arm64`: så emuleres
også udpakning og komprimering, og det tager timer.

```bash
docker run --rm --privileged -v "$PWD/kiosk:/src" -v "$PWD/kiosk/ud:/ud" debian:trixie bash /src/pi/build-pi.sh
```

En Raspberry Pi kan ikke emuleres brugbart, så Pi-billedet skal testes på en
rigtig Pi. Scripts og indhold kan kontrolleres i chroot.

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
tastetryk sendt gennem QEMU når ikke altid frem i tide. `--uden-tastatur`
fjerner både USB- og PS/2-tastaturet. `--nvram-fuld[=N]` fylder UEFI-lageret,
så kun ca. N KB er fri (standard 4), og boot-posten ikke kan gemmes. Uden KVM (Docker
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
