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
- **Går noget galt, kan det ses i admin** (fra 2026.10.25): under
  *Adgangslinks → Skærmenes hændelser* (og i super-admin for alle klubber).
  Når PC'en starter, fortæller den, hvordan den forrige kørsel sluttede —
  *stoppede brat* (frøs eller mistede strømmen), *kernenedbrud*, slukket på
  knappen eller genstartet — med slutningen af PC'ens log (*Vis log*). Den
  planlagte slukning kl. `SLUK_KL` og genstarter fra den automatiske
  opdatering meldes ikke. Genstarter browser-vagten en frossen TV-side,
  meldes det med det samme. Uden net venter hændelserne på PC'en, til nettet
  er tilbage. Det kræver, at `TV_URL` er et adgangslink (`…/t/<kode>`);
  `kiosk.conf` sendes aldrig.
- **Mister PC'en sit WiFi** (fra 2026.10.25), og kan den hverken nå serveren
  eller sin egen router, slås WiFi fra og til efter 1 minut, og PC'en
  genstarter efter 3 minutter. Hjælper det ikke, venter den længere før
  næste genstart (10, så 30 minutter) og giver op efter 3 i træk, til nettet
  har virket en halv time. Svarer routeren, men ikke serveren (internettet
  eller serveren er nede), genstartes ikke — det ville ikke hjælpe og ville
  genstarte alle hallens skærme. Svarer WiFi-kortet slet ikke (*error -110*),
  genstartes heller ikke: træk strømstikket ud. Alt meldes med WiFi-loggen
  under *Skærmenes hændelser*, når nettet er tilbage.

### Automatisk opdatering

En installeret PC (og en Raspberry Pi — se [Raspberry Pi](#raspberry-pi))
henter selv nye versioner af Badminton TV fra
[Releases](https://github.com/CesarDKK/badminton-score-counter/releases) — der
er ingen grund til at køre ud og installere forfra med USB-nøglen.

- PC'en tjekker 10 minutter efter, den er tændt, og derefter hver anden time.
  Et tjek er en lille fil; selve systemet (ca. 700 MB) hentes kun, når der er
  en ny version. TV-siden kører videre imens.
- Den nye version startes, **næste gang PC'en tændes**. Kommer TV-siden frem og
  kører i 5 minutter, beholdes den. Ellers genstarter PC'en selv til den
  forrige version efter højst 20 minutter. Det samme sker, hvis den nye
  version fryser, eller nogen slukker PC'en på knappen inden da. En version,
  der er prøvet 3 gange uden at virke, opgives, indtil der kommer en nyere.
- **Én skærm går forrest:** sæt `OPDATERING=foerst` i `kiosk.conf` på fx
  oversigtsskærmen. Den henter en ny version med det samme; de andre
  (`OPDATERING=auto`) venter, til versionen har været ude i et døgn. Ser
  oversigten forkert ud efter en opdatering, så **markér udgivelsen som
  "pre-release"** på GitHub (rediger udgivelsen → *Set as a pre-release*). Så
  henter de andre den ikke, og en rettet version kan udgives i stedet.
- **Installér nyeste nu:** kommer der nye versioner tit, når de skærme, der
  venter et døgn, aldrig frem. Under *Adgangslinks* i admin har hver TV-PC en
  knap **Installér nyeste nu**. PC'en spørger serveren hvert 2. minut
  (`opdatering spoerg`), henter så nyeste version med det samme og
  genstarter, når den er klar (skærmen er sort i 1–2 minutter). Admin viser,
  hvordan det går: henter, genstarter, opdateret — eller fejlen, og om den
  nye version ikke blev godkendt, så PC'en er gået tilbage til den forrige.
  Knappen vises kun for en PC, der har spurgt de seneste 10 minutter (tændt og
  med en version, der kan det). `OPDATERING=fra` gælder også her.
- `OPDATERING=fra` slår det fra.
- Kun PC'er, der er installeret med en version med automatisk opdatering,
  opdaterer sig selv (de har to systemer på disken, se nedenfor). Ældre
  installationer skal installeres forfra én gang.
  Det samme gælder Pi'er: skriv et nyt billede på SD-kortet én gang.

### TV'et og HDMI-CEC

De fleste PC'er kan **ikke** tænde og slukke TV'et. Grafikkortet har ikke
HDMI-CEC forbundet. M920x har DisplayPort, og et almindeligt passivt
DP→HDMI-kabel sender ikke CEC videre.

Systemet prøver automatisk og bruger CEC, hvis Linux finder det. Ellers:

- **Tænd TV'et** med fjernbetjeningen.
- **Sluk:** De fleste TV'er kan selv gå i standby, når signalet forsvinder. Slå
  det til i TV'ets menu — det hedder fx *Sluk ved intet signal*, *Auto Power
  Off* eller *No Signal Power Off*.

### Livestream fra et USB-kamera (kun PC)

Sæt et USB-webkamera i TV-PC'en, så kan banen sendes til YouTube:

- **Holdkampe** sendes af sig selv og uden afbrydelser — fra første delkamp
  sættes på banen, også mellem delkampene, til 2 minutter (kan sættes til
  0–10 i admin) efter holdkampens sidste delkamp er afgjort.
- **Andre kampe** startes på tabletten: *Indstillinger → Start livestream*.
  Kampen på banen sendes, eller den næste, hvis den sættes på inden 5
  minutter — og kun den ene kamp.
- **Hele dagen** (fx en turnering): *Send hele dagen* i admin. Alt på banen
  sendes, også mellem kampene, til PC'en slukker kl. 23:59.

Mens banen sendes, har TV'et en rød ramme og "● LIVE" ved uret (mellem
kampene i rammens hjørne), så spillerne kan se, at de bliver filmet.

Badmintonplanner-kampe sendes aldrig. Alt indstilles i admin under
**Livestream**:

1. **Kamera (TV-PC):** vælg adgangslinket til den PC, kameraet sidder i. Det
   er kameraets bane — også hvis TV'et senere skiftes til en anden bane.
2. **Stream-nøgle:** fra YouTube Studio → *Gå live* → *Stream*. Én nøgle pr.
   bane. Nøglen ligger kun på serveren, aldrig på USB-nøglen.
3. **Livestream slået til** sættes af sig selv, når banen har både kamera og
   nøgle (eller klubbens YouTube-kanal er forbundet). Før det er fluebenet gråt.
   Tryk **Gem**. Fjern fluebenet for at holde banen ude af livestream uden at
   miste kamera og nøgle.

Om streamen er offentlig, bestemmes i YouTube Studio: *Gå live* → *Stream* →
*Rediger* → *Synlighed: Offentlig*. YouTube husker valget for nøglen.

Admin viser, om PC'en sender (og i hvilken opløsning), venter på en kamp,
ikke finder kameraet, eller om YouTube afviser nøglen. Et scoreboard (kan slås
fra pr. bane) viser banen, navnene med klublogoer (de samme som på TV'et:
holdenes i en holdkamp, ellers spillernes klubber), sættene, stillingen og
hvem der server — tegnet med Pillow (Inter og Bebas Neue).

**Billede og overlay** (fælles for alle baner, i admin):

| Indstilling | Valg | Standard |
|---|---|---|
| Opløsning | 480p, 720p, 1080p | 720p |
| Billeder i sekundet | 25, 30, 50, 60 | 30 |
| Kvalitet | lav, normal, høj (fx 720p @ 30: 2,1 / 3,5 / 5,3 Mbit/s) | normal |
| Overlay: placering | de fire hjørner | øverst til venstre |
| Overlay: størrelse | lille, normal, stor | normal |
| Efter kampen | 0–10 minutter | 2 min |
| Klubbens logo | klubbens eget fra logo-databasen, eller et uploadet (vinder) | logo-databasens |

Kan kameraet ikke det valgte, sender det det bedste, det kan derunder
(`v4l2-ctl --list-formats-ext`): opløsningen går forud for billederne, så
1080p @ 60 bliver 1080p @ 30 på et kamera, der kun kan 60 i 720p. Har kameraet
ikke opløsningen, men en større, skaleres den ned. Admin viser, hvad der
faktisk sendes.

**Kameraet på banen** (pr. bane): vend billedet 180° (kameraet hænger på
hovedet), spejlvend, autofokus (fra som standard — fast fokus på lang afstand
er skarpest, autofokus "pumper", når spillerne løber), lyd fra kameraets
mikrofon, og logo i hjørnet: intet, banens sponsor (bane-bannerne, de skifter
som på TV'et) eller klubbens logo (standard). Logoet står i den modsatte side af
scoreboardet.

Lyden tages kun fra mikrofonen i selve kameraet (samme USB-enhed), aldrig fra
en anden mikrofon. Uden lyd sendes et lydløst lydspor (YouTube vil have lyd).
Kan mikrofonen ikke åbnes, sendes der uden lyd i stedet for slet ikke. **Musik
i hallen** kan få YouTube til at slå lyden fra eller blokere streamen pga.
ophavsret — admin advarer, når lyden slås til.

Kameraet stilles altid til 50 Hz. Indstillingerne kræver Badminton TV fra
denne version — ældre versioner sender 1280x720 @ 30 uden lyd som før.

Kameraet skal kunne sende MJPEG — det kan alle Logitech-kameraer (C920:
1080p @ 30, 720p @ 30).
Til 4 m bag banen skal synsvinklen være mindst ~90° diagonalt (fx Logitech
C930e eller Brio 505). Et USB-kabel længere end 3–5 m skal være aktivt.

### Ting der kan drille

| Symptom | Løsning |
|---|---|
| "WiFi-kortet svarer ikke" — selvom WiFi virkede under Windows | Sluk PC'en, **træk strømstikket ud i 1 minut**, og tænd igen. Windows kan efterlade kortet i en strømsparetilstand, og M.2-kortet har strøm, selv når PC'en er slukket — derfor hjælper en genstart ikke. Set på M920x med Intel AC 8265 |
| PC'en vil ikke starte fra nøglen | Slå *Secure Boot* fra i BIOS (F1 ved opstart på Lenovo) |
| "PC'en har flere diske" | Skriv den rigtige i `kiosk.conf`, fx `DISK=/dev/nvme0n1` |
| Venter på forbindelse i lang tid | Skærmen viser årsagen (forkert kode, netværket kan ikke ses, intet WiFi-kort …). Kun WPA2/WPA3 med adgangskode — ikke netværk med login-side eller brugernavn. Kør *Test uden at installere* i 6 minutter og se `diagnose.txt` på nøglen |
| Teksten er for lille/stor | `SKALERING=1.5` (eller et andet tal) i `kiosk.conf`, og installér igen |
| Uret er forkert første gang | Retter sig, når PC'en har været på nettet. Indtil da springes den automatiske slukning over |
| PC'en er tændt, men skærmen står som "uden forbindelse" i admin, indtil TV'et tændes | Uden TV er der intet display, og Chromium regner siden for skjult og bremser dens timere — livstegnene kom kun én gang i minuttet. Fra 2026.10.9 er bremsningen slået fra, og browser-vagten genstarter ikke en skjult side. Men på nogle PC'er (5 af 10 i Lyngby, samme model) forsvinder skærmen helt for Linux, når TV'et er slukket — og uden nogen skærm starter Chromium slet ikke. Fra 2026.10.12 har `cage` en usynlig skærm ved siden af den rigtige, så TV-siden altid kører; TV'et overtager, når det er tændt |
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
- **Automatisk opdatering** virker som på PC'en (se ovenfor), men kræver et
  SD-kort på mindst 16 GB. Når en ny version er hentet, genstarter Pi'en én
  gang ekstra lige efter, den er tændt, for at prøve den (tryboot). Mapperne
  `a` og `b` på kortet er de to systemer. `diagnose.txt` viser opdateringens
  tilstand.

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
    ├── test-opdatering.sh   tests af den automatiske opdaterings beslutninger
    ├── vm.sh                kør hele forløbet i en virtuel UEFI-PC
    └── opdatering-vm.sh     testdata til opdateringen i den virtuelle PC
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

**To systemer (A/B):** Disken har en EFI-partition og to ens
systempartitioner, `badminton-tv-a` og `badminton-tv-b` (højst 16 GB hver).
Installationen lægger systemet på A. En opdatering er det samme som en
installation: live-systemets `filesystem.squashfs` (som udgivelsen også har
som `badminton-tv-rod-<version>.squashfs`) kopieres til det ledige system, og
PC'ens `kiosk.conf`, navn og maskine-id følger med. Derfor kommer alle
ændringer med — pakker, fstab, kerneparametre — uden opgraderingsscripts.

GRUB på EFI-partitionen (`\EFI\debian\grub.cfg` = `grub-esp.cfg`) vælger
systemet ud fra `badminton-tv.env` ved siden af: `aktiv=a|b` og `proev=a|b`.
`proev` slettes af GRUB selv, før det nye system startes (med
`badminton.forsoeg=1`), så næste opstart altid er det gamle, medmindre
`badminton-tv-opdatering-bekraeft` har sat `aktiv` efter 5 minutter med
TV-siden fremme. Kernen og dens parametre står i systemet selv
(`grub-slot.cfg`), så de følger med opdateringerne. Vælgeren skrives kun af
installeren. GRUB- og shim-pakkerne sættes i bero (`apt-mark hold`), når et
system lægges på disken, fordi deres opgradering ville køre `grub-install` og
overskrive vælgeren.

**Raspberry Pi** har ingen GRUB: firmwaren henter kernen fra SD-kortets
FAT-partition. Kortet har derfor mapperne `a\` og `b\` med hvert systems
kerne, initramfs, device trees, overlays og `cmdline.txt` (`root=` og
`badminton.slot=`), og `config.txt` slutter med en blok, der vælger mappen med
`os_prefix` — og den anden mappe under `[tryboot]`. FAT-partitionen er
monteret på `/boot/kort`, og det kørende systems mappe er bundet til
`/boot/firmware`, så Raspberry Pi OS' kerneopdateringer lander i den rigtige
mappe. Roden (system A) er låst til 6 GB (ingen `resize`), og system B
oprettes af den første opdatering bag den. Tilstanden ligger i
`badminton-tv-opdatering.txt` på FAT-partitionen. Ved opstart genstarter
`badminton-tv-opdatering-proev` med `reboot "0 tryboot"`, hvis en ny version
venter (og sletter `proev` først); firmwaren glemmer tryboot igen, så en
mislykket prøve, et strømsvigt eller `panic=10` ender i det gamle system.
`bekraeft` skriver `config.txt` om, når TV-siden har kørt i 5 minutter.
`dtparam=watchdog=on` genstarter en Pi, der fryser, før Linux kører.
Udgivelsen har `opdatering-pi.json` og `badminton-tv-pi-rod-<version>.squashfs`
(roden med mappens filer i `/boot/firmware`).

Manifestet `opdatering.json` (version, udgivelsestid, `vent_timer`, filnavn,
SHA256, størrelse) signeres med en ed25519-nøgle ved udgivelsen. PC'en
tjekker signaturen med `opdatering.pub` fra sit eget system, før den bruger
noget fra det.

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
| Automatisk opdatering (hent, godkend, status) | `usr/lib/badminton-tv/opdatering` |
| Hændelser til serveren (hvordan forrige kørsel sluttede, browser-genstarter) | `usr/lib/badminton-tv/rapport` |
| Livestream fra USB-kameraet (spørger `/api/livestream/pc`, styrer ffmpeg) — kun PC | `usr/lib/badminton-tv/stream` |
| Fælles for installation og opdatering | `usr/lib/badminton-tv/rod.sh` |
| GRUB: vælger A/B, og hvert systems opstartslinje | `usr/share/badminton-tv/grub-esp.cfg`, `grub-slot.cfg` |

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

Versionen er datoen (`ÅÅÅÅ.M.D`); en ekstra udgivelse samme dag får `.1`,
`.2` … PC'er med 2026.10.29.1 eller ældre godtager kun tre dele — de sprang
`2026.10.28.1` og `2026.10.29.1` over (manifestet "kan ikke læses"). Fra
2026.10.31 godtages en fjerde del.

Udgivelsen får også `opdatering.json` og `opdatering.json.sig`, som de
installerede PC'er henter via `releases/latest/download/` — så **den seneste
udgivelse, der ikke er pre-release, er den, PC'erne opdaterer til**. Andre
slags udgivelser i dette repo ville forstyrre det.

**Signeringsnøglen:** Release-jobbet signerer manifestet med secret
`TV_OPDATERING_NOEGLE` (*Settings → Secrets and variables → Actions*): hele
indholdet af en PEM-fil med en ed25519-nøgle. Mangler den, fejler jobbet, og
der udgives intet. Den offentlige halvdel ligger i
`usr/share/badminton-tv/opdatering.pub`. Mistes nøglen, kan der laves en ny,
men så skal alle PC'er installeres forfra én gang, fordi de kun stoler på den
gamle:

```bash
openssl genpkey -algorithm ed25519 -out opdateringsnoegle.pem
```

```bash
openssl pkey -in opdateringsnoegle.pem -pubout -out kiosk/live/config/includes.chroot_after_packages/usr/share/badminton-tv/opdatering.pub
```

**Test af opdateringen** i den virtuelle PC: `test/opdatering-vm.sh` laver et
USB-billede, der henter fra en lokal server med en testnøgle, plus en ny og en
bevidst ødelagt version. Forløbet står øverst i scriptet. Selve
beslutningerne (hvornår der hentes, signatur, antal forsøg) testes uden VM af
`test/test-opdatering.sh`, som også kører i CI.
