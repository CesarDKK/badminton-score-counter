#!/bin/bash
# Test af net-vagten i browservagt (usr/lib/badminton-tv/browservagt): hvornår
# WiFi'en genforbindes (1 min), PC'en genstartes (3 min, så 10, så 30), og hvad
# der meldes. Uret og nettet er falske, så testen tager et par sekunder.
#
#   bash kiosk/test/test-netvagt.sh

set -u
cd "$(dirname "$0")/.." || exit 1
VAGT=$PWD/live/config/includes.chroot_after_packages/usr/lib/badminton-tv/browservagt
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

BT_NET_TILSTAND="$TMP/netvagt.json" python3 - "$VAGT" <<'EOF'
import importlib.machinery, importlib.util, sys

loader = importlib.machinery.SourceFileLoader('browservagt', sys.argv[1])
spec = importlib.util.spec_from_loader('browservagt', loader)
v = importlib.util.module_from_spec(spec)
loader.exec_module(v)
v.log = lambda tekst: None

fejl = 0
def forvent(navn, faktisk, forventet):
    global fejl
    if faktisk == forventet:
        print(f'  ok    {navn}')
    else:
        print(f'  FEJL  {navn}\n        fik:       {faktisk!r}\n        forventet: {forventet!r}')
        fejl += 1


class Hal:
    """Falsk net og ur: serveren og routeren svarer, eller gør ikke."""
    def __init__(self, raekke=None, kortfejl=False, optaget=False):
        import json, os
        if raekke is None:
            if os.path.exists(v.NET_TILSTAND):
                os.remove(v.NET_TILSTAND)
        else:
            json.dump({'raekke': raekke}, open(v.NET_TILSTAND, 'w'))
        self.t = 1_800_000_000.0
        self.server = True
        self.router = True
        self.haendelser, self.genforbind, self.genstart = [], 0, []
        self.vagt = v.Netvagt(
            'https://klub.test', ur=lambda: self.t,
            server_ok=lambda s: self.server, lokal_ok=lambda: self.router,
            kortfejl=lambda: kortfejl, optaget=lambda: optaget,
            genforbind=self._genforbind, genstart=self._genstart,
            koe=lambda typ, tekst, fra, til=None: self.haendelser.append((typ, tekst, fra, til)),
            send=lambda: None)

    def _genforbind(self):
        self.genforbind += 1

    def _genstart(self):
        self.genstart.append(self.t - self.start)

    def koer(self, sek):
        """Tikker hvert 20. sekund i sek sekunder."""
        slut = self.t + sek
        while self.t < slut:
            self.t += 20
            self.vagt.tik()

    def nede(self, router=False):
        self.server, self.router = False, router
        self.start = self.t + 20   # det første tjek, der ser hullet

    def oppe(self):
        self.server = self.router = True

    def typer(self):
        return [h[0] for h in self.haendelser]


print('Net-vagten')

h = Hal()
h.koer(600)
forvent('nettet virker: intet sker', (h.genforbind, h.genstart, h.typer()), (0, [], []))

# Internettet/serveren nede, men routeren svarer: ingen genstart
h = Hal(); h.nede(router=True); h.koer(1200)
forvent('serveren væk, routeren svarer: ingen genforbindelse eller genstart', (h.genforbind, h.genstart), (0, []))
h.oppe(); h.koer(20)
forvent('… og når den er tilbage: net-server', h.typer(), ['net-server'])
forvent('… med teksten om hallens netværk', 'hallens netværk virkede' in h.haendelser[0][1], True)

# PC'ens egen forbindelse væk: 1 min → WiFi fra/til, 3 min → genstart
h = Hal(); h.nede(); h.koer(59)
forvent('routeren væk i 59 s: intet endnu', (h.genforbind, h.genstart), (0, []))
h.koer(20)
forvent('efter 1 minut: WiFi slås fra og til (én gang)', h.genforbind, 1)
h.koer(90)
forvent('… ikke igen', h.genforbind, 1)
forvent('… og ingen genstart endnu (under 3 min)', h.genstart, [])
h.koer(20)
forvent('efter 3 minutter: PC\'en genstartes', h.genstart, [180.0])
forvent('… og net-genstart meldes', h.typer(), ['net-genstart'])
forvent('… genstart nr. 1 gemmes', v.Netvagt('x').raekke, 1)

# Efter genstarten (ny proces, samme tilstand): næste genstart først efter 10 min
h = Hal(raekke=1); h.nede(); h.koer(590)
forvent('2. gang: ingen genstart efter 3 min', h.genstart, [])
h.koer(20)
forvent('2. gang: genstart efter 10 min', h.genstart, [600.0])
h = Hal(raekke=2); h.nede(); h.koer(1820)
forvent('3. gang: genstart efter 30 min', h.genstart, [1800.0])
h = Hal(raekke=3); h.nede(); h.koer(4 * 3600)
forvent('efter 3 genstarter i træk: gives der op', h.genstart, [])
forvent('… men WiFi slås stadig fra og til', h.genforbind, 1)

# Kommer igen efter WiFi fra/til: net-wifi
h = Hal(); h.nede(); h.koer(100); h.oppe(); h.koer(20)
forvent('WiFi tilbage efter fra/til: net-wifi', h.typer(), ['net-wifi'])
forvent('… "efter at WiFi blev slået fra og til"', 'efter at WiFi blev slået fra og til' in h.haendelser[0][1], True)

# Kort hul (under et minut): intet meldes
h = Hal(); h.nede(); h.koer(40); h.oppe(); h.koer(20)
forvent('hul på 40 s: intet meldes', h.typer(), [])

# Nettet virker en halv time efter en genstart: tælles forfra
h = Hal(raekke=2); h.koer(1800)
forvent('nettet har virket en halv time: genstarter tælles forfra', v.Netvagt('x').raekke, 0)
h = Hal(raekke=2); h.koer(600)
forvent('… men ikke efter 10 minutter', v.Netvagt('x').raekke, 2)

# WiFi-kortet svarer ikke (error -110): hverken fra/til eller genstart — meldes én gang
h = Hal(kortfejl=True); h.nede(); h.koer(3600)
forvent('WiFi-kortet dødt: ingen genforbindelse eller genstart', (h.genforbind, h.genstart), (0, []))
forvent('… net-kort meldes én gang', h.typer(), ['net-kort'])

# Den automatiske slukning/opdatering kører: ingen genstart
h = Hal(optaget=True); h.nede(); h.koer(600)
forvent('slukning/opdatering i gang: ingen genstart', h.genstart, [])

# Routeren findes ud fra /proc/net/route (little-endian hex)
import socket, struct
forvent('gateway fra /proc/net/route-format', socket.inet_ntoa(struct.pack('<I', int('0102A8C0', 16))), '192.168.2.1')

print()
if fejl:
    print(f'{fejl} test(s) fejlede.')
    sys.exit(1)
print('Alle tests bestået.')
EOF
