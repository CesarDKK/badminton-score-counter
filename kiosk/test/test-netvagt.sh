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
import socket

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

# Grunden kommer med i net-server-hændelsen
h = Hal(); h.server = v.Svar(False, 'timeout ved forbindelsen (104.21.5.133)', False); h.router = True
h.koer(120); h.oppe(); h.koer(20)
forvent('net-server med grunden', h.haendelser[0][1].endswith('hallens netværk virkede — timeout ved forbindelsen (104.21.5.133)'), True)
h = Hal(); h.nede(router=True); h.koer(120); h.oppe(); h.koer(20)
forvent('… uden grund (gammel/udskiftet tjek-funktion) som før', h.haendelser[0][1].endswith('hallens netværk virkede'), True)

# Serveren svarer kun over IPv4: ingen udfald (TV'et mærker det ikke), men net-ipv6 meldes bagefter
KUN4 = v.Svar(True, 'over IPv6: timeout efter forbindelsen (kryptering/svar) (2606:4700::1)', True)
h = Hal(); h.server = KUN4; h.koer(300)
forvent('kun IPv4 i 5 min: ingen genforbindelse, genstart eller hændelse endnu', (h.genforbind, h.genstart, h.typer()), (0, [], []))
h.oppe(); h.koer(20)
forvent('… IPv6 igen: net-ipv6 meldes', h.typer(), ['net-ipv6'])
forvent('… med grunden og varigheden', ('5 min' in h.haendelser[0][1], '2606:4700::1' in h.haendelser[0][1]), (True, True))
h = Hal(); h.server = KUN4; h.koer(40); h.oppe(); h.koer(20)
forvent('kun IPv4 i 40 s: intet meldes', h.typer(), [])
h = Hal(); h.server = KUN4; h.koer(100); h.nede(router=True); h.koer(100); h.oppe(); h.koer(20)
forvent('kun IPv4, så helt væk, så tilbage: net-ipv6 og net-server', h.typer(), ['net-ipv6', 'net-server'])

# enhed_koerer: oneshot-tjenester er 'activating', mens de kører (is-active svarer da 3)
import subprocess as sp
aegte_run = v.subprocess.run
for tilstand, kode, forventet in (('activating', 3, True), ('active', 0, True), ('inactive', 3, False),
                                  ('failed', 3, False), ('', 4, False)):
    v.subprocess.run = lambda *a, t=tilstand, k=kode, **kw: sp.CompletedProcess(a, k, stdout=t + '\n', stderr='')
    forvent(f'enhed_koerer: {tilstand or "ukendt enhed"} → {forventet}', v.enhed_koerer('badminton-tv-sluk.service'), forventet)
def uden_systemctl(*a, **kw):
    raise FileNotFoundError('systemctl')
v.subprocess.run = uden_systemctl
forvent('enhed_koerer: uden systemctl → nej', v.enhed_koerer('x.service'), False)
kald = []
v.subprocess.run = lambda args, **kw: (kald.append(args[-1]), sp.CompletedProcess(args, 3, stdout='inactive\n'))[1]
forvent('pc_er_optaget spørger slukning og opdatering', (v.pc_er_optaget(), kald),
        (False, ['badminton-tv-sluk.service', 'badminton-tv-opdatering.service']))
v.subprocess.run = aegte_run

# beskriv_fejl: fejlene i ord
import errno as en
forvent('fejl: DNS', v.beskriv_fejl(socket.gaierror(-3, 'Temporary failure in name resolution'), False), 'navneopslaget (DNS) fejlede')
forvent('fejl: timeout før forbindelsen', v.beskriv_fejl(TimeoutError('timed out'), False), 'timeout ved forbindelsen')
forvent('fejl: timeout efter forbindelsen', v.beskriv_fejl(TimeoutError('timed out'), True), 'timeout efter forbindelsen (kryptering/svar)')
forvent('fejl: ingen rute', v.beskriv_fejl(OSError(en.ENETUNREACH, 'Network is unreachable'), False), 'ingen rute til serveren')
forvent('fejl: afvist', v.beskriv_fejl(ConnectionRefusedError(111, 'refused'), True), 'forbindelsen blev afvist')

# spoerg_server/server_svarer mod rigtige sokler på maskinen
import threading
v.SERVER_TIMEOUT = 1

def lyt(familie, adresse, svar):
    """En server, der svarer HTTP (svar=bytes) eller tager imod og tier (svar=None)."""
    s = socket.socket(familie, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((adresse, 0)); s.listen(8)
    def koer():
        while True:
            try:
                k, _ = s.accept()
            except OSError:
                return
            if svar is not None:
                k.recv(4096); k.sendall(svar); k.close()
    threading.Thread(target=koer, daemon=True).start()
    return s, s.getsockname()[1]

FORBUDT = b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
s403, p = lyt(socket.AF_INET, '127.0.0.1', FORBUDT)
forvent('server svarer 403 (Cloudflare mod bots): det er et svar', v.server_svarer(f'http://127.0.0.1:{p}'), v.Svar(True, None, False))
lukket = socket.socket(); lukket.bind(('127.0.0.1', 0)); p = lukket.getsockname()[1]   # lytter aldrig
forvent('lukket port: afvist med adressen', v.server_svarer(f'http://127.0.0.1:{p}'),
        v.Svar(False, 'forbindelsen blev afvist (127.0.0.1)', False))
stille, p = lyt(socket.AF_INET, '127.0.0.1', None)
forvent('serveren tager imod, men svarer aldrig: timeout efter forbindelsen', v.server_svarer(f'http://127.0.0.1:{p}'),
        v.Svar(False, 'timeout efter forbindelsen (kryptering/svar) (127.0.0.1)', False))
stille.close()
forvent('navnet findes ikke: DNS', v.spoerg_server('http://findes-ikke.invalid')[0], 'navneopslaget (DNS) fejlede')

# IPv6 hænger, IPv4 svarer — på samme navn og port (localhost har ::1 og 127.0.0.1)
try:
    s6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    s6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    s6.bind(('::1', 0)); s6.listen(8)
    p = s6.getsockname()[1]
    s4 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s4.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s4.bind(('127.0.0.1', p)); s4.listen(8)
    ipv6 = [a[4][0] for a in socket.getaddrinfo('localhost', p, 0, socket.SOCK_STREAM)][:1] == ['::1']
except OSError:
    ipv6 = False
if ipv6:
    threading.Thread(target=lambda: [s6.accept() for _ in range(8)], daemon=True).start()   # tier
    def svar4():
        while True:
            k, _ = s4.accept(); k.recv(4096); k.sendall(FORBUDT); k.close()
    threading.Thread(target=svar4, daemon=True).start()
    forvent('IPv6 tier, IPv4 svarer: ok, men kun over IPv4 — med IPv6-grunden',
            v.server_svarer(f'http://localhost:{p}'),
            v.Svar(True, 'over IPv6: timeout efter forbindelsen (kryptering/svar) (::1)', True))
else:
    print('  (sprunget over: localhost har ikke ::1 først i denne container)')

# Routeren findes ud fra /proc/net/route (little-endian hex)
import struct
forvent('gateway fra /proc/net/route-format', socket.inet_ntoa(struct.pack('<I', int('0102A8C0', 16))), '192.168.2.1')

print()
if fejl:
    print(f'{fejl} test(s) fejlede.')
    sys.exit(1)
print('Alle tests bestået.')
EOF
