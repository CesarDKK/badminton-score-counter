"""CP-SAT-løser til planner.badmintonapp.dk (Google OR-Tools).

Modtager et anonymiseret planlægningsproblem fra planner/src/solver-klient.js:
kamp-id'er, spillere som løbenumre, tilladte starttider, kapacitet pr. slot og
konfliktpar. Ingen navne eller andre persondata.

Hårde regler er constraints; bløde ønsker er en vægtet sum, der minimeres
(samme kriterier og vægte som planner/src/kriterier.js, hvor de kan udtrykkes
lineært). Findes der ingen lovlig plan, svarer løseren INFEASIBLE i stedet for
at aflevere "den mindst ringe".

Tiden er global: T = dagindex * 1440 + startminut.
"""
from __future__ import annotations

import json
import math
import os
import re
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ortools.sat.python import cp_model

DAG = 1440
MAX_SEKUNDER = int(os.environ.get("SOLVER_MAX_SEKUNDER", "360"))
MAX_BYTES = int(os.environ.get("SOLVER_MAX_BYTES", str(5 * 1024 * 1024)))
MAX_KAMPE = int(os.environ.get("SOLVER_MAX_KAMPE", "2000"))
ARBEJDERE = int(os.environ.get("SOLVER_ARBEJDERE", "2"))
SAMTIDIGE = threading.Semaphore(int(os.environ.get("SOLVER_SAMTIDIGE", "1")))
# Elastisk løsning (ingen lovlig plan): pris pr. brud — pr. kamp, pr. minut eller pr. ekstra kamp/dag. Billigst først:
# pause (pr. minut), max varighed (pr. minut), tidsrum, single/double samtidig, tidsvindue, max kampe, senior, dage, max dage.
ELASTISK_PRIS = {"pause": 0.2, "haltid": 0.1, "tidsrum": 1, "antiSamtidighed": 1, "tidsvindue": 3, "maxKampe": 5, "senior": 5, "dage": 10, "maxDage": 20}
ELASTISK_SKALA = 10 ** 8  # et brud til pris 1 vejer mere end alle bløde ønsker tilsammen
ELASTISK_SEKUNDER = float(os.environ.get("SOLVER_ELASTISK_SEKUNDER", "30"))  # tid til planen med færrest brud
RO_SEKUNDER = float(os.environ.get("SOLVER_RO_SEKUNDER", "15"))  # stop efter så længe uden en bedre plan (0 = aldrig)
# Vægte ganges op til heltal pr. minut (vægt 1 pr. time = 1000 pr. minut). Tidlig-start-trækket er 1 pr. minut pr. kamp og
# skal kun skille ligestillede planer: 400 kampe flyttet en halv time er under én "kampe i træk" (Fable-gennemgangen, M8).
SKALA = 60000
MAX_DAGE = 14  # længste turnering, løseren tager imod


def valider(problem) -> str | None:
    """Afviser et problem, der ikke har den form og størrelse, bygProblem() laver — før det får løserens ene plads.

    Opbygningen af modellen kan ikke afbrydes undervejs, så størrelsen skal holdes nede: højst MAX_KAMPE kampe, de
    tilladte tider inden for dagene og højst ELEMENTER_PR_KAMP tal i alle lister tilsammen pr. kamp (målt 2026-10-10:
    Lyngby U9/U11 har ca. 60). Returnerer en fejltekst eller None (Fable-gennemgangen 2026-10-10, V4)."""
    try:
        return _valider(problem)
    except (TypeError, AttributeError, ValueError, KeyError):
        return "problemet har ikke den form, planneren sender"


def _valider(problem) -> str | None:
    if not isinstance(problem, dict):
        return "problemet skal være et objekt"
    slot, kampe, dage = problem.get("slotMin"), problem.get("kampe"), problem.get("dage", [])
    if not isinstance(slot, int) or isinstance(slot, bool) or not 5 <= slot <= 180:
        return "slotMin skal være et helt antal minutter (5-180)"
    if not isinstance(kampe, list):
        return "kampe mangler"
    if len(kampe) > MAX_KAMPE:
        return f"højst {MAX_KAMPE} kampe"
    if not isinstance(dage, list) or len(dage) > MAX_DAGE:
        return f"højst {MAX_DAGE} dage"
    n = len(kampe)
    max_tider = max(1, len(dage)) * (DAG // slot)
    for k in kampe:
        if not isinstance(k, dict) or not isinstance(k.get("tilladte"), list) or len(k["tilladte"]) > max_tider:
            return "ugyldig kamp (tilladte tider)"
        if not all(type(t) is int and 0 <= t < MAX_DAGE * DAG for t in k["tilladte"]):
            return "ugyldig kamp (tilladte tider)"
    # Kapaciteten og tiderne for planen med færrest brud og diagnosen: samme krav som kampenes tider (før kunne et
    # ugyldigt tal her først vælte løseren midt i kørslen — gennemgangen 2026-10-17)
    tid = lambda t: type(t) is int and 0 <= t < MAX_DAGE * DAG
    tider_ok = lambda xs: isinstance(xs, list) and len(xs) <= max_tider and all(tid(t) for t in xs)
    kap = problem.get("kapacitet")
    if not isinstance(kap, dict) or not all(isinstance(slots, list) and len(slots) <= max_tider and all(
            isinstance(s, dict) and tid(s.get("t")) and type(s.get("baner")) is int and 0 <= s["baner"] <= 1000 for s in slots) for slots in kap.values()):
        return "ugyldig kapacitet"
    # Alle tal i problemet tælles (rekursivt); kommatal skal være endelige
    budget = ELEMENTER_PR_KAMP * n + 10000
    stak, antal = [v for key, v in problem.items() if key != "kampe"], 0
    while stak:
        x = stak.pop()
        if isinstance(x, dict):
            stak.extend(x.values())
        elif isinstance(x, list):
            stak.extend(x)
        elif isinstance(x, float) and not math.isfinite(x):
            return "ugyldigt tal"
        antal += 1
        if antal > budget:
            return "problemet er for stort"
    # Kampindeks skal pege på kampe
    inde = lambda i: type(i) is int and 0 <= i < n
    for navn in ("foer", "konflikter", "ikkeSamtidig", "ikkeSammeDag"):
        for par in problem.get(navn, []):
            if not isinstance(par, list) or len(par) < 2 or not (inde(par[0]) and inde(par[1])):
                return f"ugyldigt {navn}"
    stabil = problem.get("stabil") or {}
    if not isinstance(stabil, dict) or not all(inde(i) for i in stabil.get("kampe", [])):
        return "ugyldig stabil"
    net = problem.get("nethoejde", {})
    if not isinstance(net, dict) or not all(isinstance(net.get(n, []), list) and all(inde(i) for i in net.get(n, [])) for n in ("saenket", "normal")):
        return "ugyldig nethoejde"
    for par in problem.get("cupVent", []):
        if not isinstance(par, list) or len(par) != 2 or not inde(par[0]) or not isinstance(par[1], list) or not par[1] or not all(inde(i) for i in par[1]):
            return "ugyldigt cupVent"
    for navn in ("traek", "huller", "mangeKampe"):
        for liste in problem.get(navn, []):
            if not isinstance(liste, list) or not all(inde(i) for i in liste):
                return f"ugyldigt {navn}"
    for runder in problem.get("puljerunder", []):
        if not isinstance(runder, list) or not all(isinstance(r, list) and all(inde(i) for i in r) for r in runder):
            return "ugyldige puljerunder"
    for navn in ("haltid", "spillerGrupper", "halTid", "maxDage", "maxPrGruppe", "alternativer"):
        for g in problem.get(navn, []):
            if not isinstance(g, dict) or not all(inde(i) for i in g.get("kampe", [])):
                return f"ugyldigt {navn}"
    for navn in ("alternativer", "elastisk"):
        for g in problem.get(navn, []):
            if not all(isinstance(x, list) and len(x) == 2 and inde(x[0]) and tider_ok(x[1]) for x in g.get("forbudt", [])):
                return f"ugyldigt {navn}"
            if not all(tider_ok(g.get(felt, [])) for felt in ("tilladte", "tidsrum", "tidsvindue", "dage")):
                return f"ugyldigt {navn}"
    return None


ELEMENTER_PR_KAMP = 400


class _Stoppet(Exception):
    """Stop under opbygningen af modellen (den del, CP-SAT's stop_search ikke når)."""


def loes(problem: dict, sekunder: float = 30.0, arbejdere: int | None = None, stop: threading.Event | None = None, foerste: bool = False, elastisk: bool = False) -> dict:
    try:
        return _loes(problem, sekunder, arbejdere, stop, foerste, elastisk)
    except _Stoppet:
        return {"status": "UNKNOWN", "tider": {}, "sekunder": 0.0, "stoppet": True, "rolig": False, "besked": "Løseren blev stoppet, før søgningen gik i gang."}


def _loes(problem: dict, sekunder: float, arbejdere: int | None, stop: threading.Event | None, foerste: bool, elastisk: bool) -> dict:
    """elastisk=True: planen med færrest mulige regelbrud (når der ingen lovlig plan er). De hårde regler må brydes,
    men hvert brud koster (ELASTISK_PRIS) langt mere end alle bløde ønsker tilsammen. Banerne og rækkefølgen (en
    kamp efter dem, den bygger på) brydes aldrig. Svaret har "brud": hvilke regler planen bryder, og hvor meget."""
    t0 = time.time()
    slot = int(problem["slotMin"])
    kampe = problem["kampe"]
    n = len(kampe)
    if n == 0:
        return {"status": "OPTIMAL", "tider": {}, "sekunder": 0.0, "maal": 0, "graense": 0}
    if n > MAX_KAMPE:
        return {"status": "FOR_STORT", "besked": f"Højst {MAX_KAMPE} kampe"}

    # Elastisk: kampene må også ligge uden for rækkens tidsrum, årgangens tidsvindue eller rækkens dage (klientens
    # "elastisk": tiderne pr. række pr. slags brud). Låste kampe (én tilladt tid) flyttes aldrig.
    base = [set(k["tilladte"]) for k in kampe]
    ekstra = [dict() for _ in kampe]  # kamp → {tid: regel}
    if elastisk:
        pr_raekke = {e["raekke"]: e for e in problem.get("elastisk", [])}
        # Tider, en kamp aldrig må have, selv om rækken bryder sit tidsrum/sine dage (E- og senior-reglerne pr. kamp)
        forbudt = {i: set(tider) for e in problem.get("elastisk", []) for i, tider in e.get("forbudt", [])}
        for i, k in enumerate(kampe):
            e = pr_raekke.get(k["raekke"])
            if not e or len(base[i]) == 1:
                continue
            for regel in ("tidsrum", "tidsvindue", "dage"):
                for t in e.get(regel, []):
                    if t not in base[i] and t not in ekstra[i] and t not in forbudt.get(i, ()):
                        ekstra[i][t] = regel
        kampe = [({**k, "tilladte": sorted(base[i] | set(ekstra[i]))} if ekstra[i] else k) for i, k in enumerate(kampe)]
    for k in kampe:
        if not k["tilladte"]:
            return {"status": "INFEASIBLE", "besked": f"Kampen {k['id']} har ingen tilladte tider (tjek rækkens dage, tidsrum og tidsvindue).", "tider": {}, "sekunder": 0.0}

    def tjek_stop():
        if stop is not None and stop.is_set():
            raise _Stoppet()

    m = cp_model.CpModel()
    T = [m.NewIntVarFromDomain(cp_model.Domain.FromValues(sorted(set(k["tilladte"]))), f"T{i}") for i, k in enumerate(kampe)]
    # Regelbrud (kun elastisk): (pris, variabel, beskrivelse) — beskrivelsen bliver til "brud" i svaret
    brud = []
    def bryd(pris, var, **info):
        brud.append((pris, var, info))
    ude_for = {}  # kamp → bool: ligger uden for sine normale tider (rækker med egne baner spiller så på de fælles)
    for i, ek in enumerate(ekstra):
        if not ek:
            continue
        ude = []
        for regel in ("tidsrum", "tidsvindue", "dage"):
            tider = sorted(t for t, r in ek.items() if r == regel)
            if not tider:
                continue
            b = m.NewBoolVar(f"ude_{regel}_{i}")
            resten = sorted(set(kampe[i]["tilladte"]) - set(tider))
            m.AddLinearExpressionInDomain(T[i], cp_model.Domain.FromValues(tider)).OnlyEnforceIf(b)
            m.AddLinearExpressionInDomain(T[i], cp_model.Domain.FromValues(resten)).OnlyEnforceIf(b.Not())
            bryd(ELASTISK_PRIS[regel], b, regel=regel, kamp=kampe[i]["id"], raekke=kampe[i]["raekke"])
            ude.append(b)
        u = m.NewBoolVar(f"ude_{i}")
        m.AddMaxEquality(u, ude)
        ude_for[i] = u
    dage_for = [sorted({t // DAG for t in k["tilladte"]}) for k in kampe]  # de dage, kampen kan ligge på
    enkeltDag = [len(d) == 1 for d in dage_for]
    dagFor = [d[0] for d in dage_for]
    dage_i = lambda ids: sorted({d for i in ids for d in dage_for[i]})

    # Dag-variabel kun for kampe, der kan ligge på flere dage
    D = {}
    def dag_var(i):
        if enkeltDag[i]:
            return dagFor[i]
        if i not in D:
            d = m.NewIntVar(dage_for[i][0], dage_for[i][-1], f"D{i}")
            m.AddDivisionEquality(d, T[i], DAG)
            D[i] = d
        return D[i]

    # ── Kapacitet pr. pulje: cumulative med faste "blokke" der fylder det, banerne ikke rækker til ──
    # Hel bane = 2, halv bane = 1, kapacitet = 2 x baner. Ækvivalent med hele + ceil(halve/2) <= baner.
    # En kamp fra en række med egne baner spiller på dem eller "løber over" på en fri fælles bane — samme regel som
    # Tjek (kapacitet.js banebrugISlot). Ligger den (elastisk) uden for rækkens tider, spiller den på de fælles baner.
    pr_pulje = {}  # pulje → [(interval, krav, mulige tider)]
    for i, k in enumerate(kampe):
        krav_i = 1 if k["halv"] else 2
        if k["pulje"] != "faelles" and "faelles" in problem["kapacitet"]:
            egen = m.NewBoolVar(f"egen_{i}")
            if i in ude_for:
                m.AddImplication(ude_for[i], egen.Not())
            pr_pulje.setdefault(k["pulje"], []).append((m.NewOptionalFixedSizeIntervalVar(T[i], slot, egen, f"I{k['pulje']}_{i}"), krav_i, base[i]))
            pr_pulje.setdefault("faelles", []).append((m.NewOptionalFixedSizeIntervalVar(T[i], slot, egen.Not(), f"Ifaelles_{i}"), krav_i, set(k["tilladte"])))
        else:
            pr_pulje.setdefault(k["pulje"], []).append((m.NewFixedSizeIntervalVar(T[i], slot, f"I{k['pulje']}_{i}"), krav_i, set(k["tilladte"])))
    for pulje, slots in problem["kapacitet"].items():
        led_p = pr_pulje.get(pulje)
        if not led_p:
            continue
        maxkap = max((s["baner"] for s in slots), default=0)
        tider_i_pulje = {s["t"]: s["baner"] for s in slots}
        intervaller = [iv for iv, _, _ in led_p]
        krav = [kr for _, kr, _ in led_p]
        brugte = {t for _, _, tider in led_p for t in tider}
        for t in sorted(brugte):
            baner = tider_i_pulje.get(t, 0)
            if baner < maxkap:
                intervaller.append(m.NewFixedSizeIntervalVar(t, slot, f"B{pulje}_{t}"))
                krav.append(2 * (maxkap - baner))
        m.AddCumulative(intervaller, krav, 2 * maxkap)

    # ── Rækkefølge: efterfølger mindst `gab` senere ──
    for a, b, gab in problem.get("foer", []):
        m.Add(T[b] >= T[a] + gab)

    # ── Konfliktpar: fælles (mulig) spiller → mindst `gab` mellem starttiderne ──
    for a, b, gab, ordnet in problem.get("konflikter", []):
        ta, tb = kampe[a]["tilladte"], kampe[b]["tilladte"]
        if min(tb) - max(ta) >= gab or min(ta) - max(tb) >= gab:
            continue  # kan aldrig komme for tæt på hinanden
        # Elastisk: pausen må blive kortere (pris pr. minut), men aldrig så kort, at spilleren står i to kampe på én gang
        afstand = gab
        if elastisk and gab > slot:
            mangler = m.NewIntVar(0, gab - slot, f"pause{a}_{b}")
            afstand = gab - mangler
            bryd(ELASTISK_PRIS["pause"], mangler, regel="pause", kampe=[kampe[a]["id"], kampe[b]["id"]], raekke=kampe[a]["raekke"])
        if ordnet:
            m.Add(T[b] >= T[a] + afstand)
        else:
            foerst = m.NewBoolVar(f"o{a}_{b}")
            m.Add(T[b] >= T[a] + afstand).OnlyEnforceIf(foerst)
            m.Add(T[a] >= T[b] + afstand).OnlyEnforceIf(foerst.Not())

    tjek_stop()
    for a, b in problem.get("ikkeSamtidig", []):
        if set(kampe[a]["tilladte"]) & set(kampe[b]["tilladte"]):
            if elastisk:
                samtidig = m.NewBoolVar("")
                m.Add(T[a] != T[b]).OnlyEnforceIf(samtidig.Not())
                bryd(ELASTISK_PRIS["antiSamtidighed"], samtidig, regel="antiSamtidighed", kampe=[kampe[a]["id"], kampe[b]["id"]], raekke=kampe[a]["raekke"])
            else:
                m.Add(T[a] != T[b])

    # Bool: kamp i ligger på dag d (kun for kampe, der kan ligge på flere dage). Én pr. kamp og dag, delt af alle regler
    # — før lavede spændet, max dage, max kampe og sluttiden hver deres (gennemgangen 2026-10-17)
    paa_cache = {}
    def paa_dag(i, d):
        if (i, d) not in paa_cache:
            b = m.NewBoolVar("")
            m.Add(dag_var(i) == d).OnlyEnforceIf(b)
            m.Add(dag_var(i) != d).OnlyEnforceIf(b.Not())
            paa_cache[(i, d)] = b
        return paa_cache[(i, d)]

    # ── Spænd pr. gruppe af kampe pr. dag (haltid): bruges både til max haltid (hårdt) og ventetid (blødt) ──
    spaend_cache = {}
    def spaend(gruppe):
        """Liste af (spændvariabel i minutter, antal kampe-udtryk) — ét pr. mulig dag."""
        noegle = tuple(sorted(gruppe))
        if noegle in spaend_cache:
            return spaend_cache[noegle]
        ud = []
        if all(enkeltDag[i] for i in gruppe):
            pr_dag = {}
            for i in gruppe:
                pr_dag.setdefault(dagFor[i], []).append(i)
            for d, ids in pr_dag.items():
                if len(ids) < 2:
                    continue
                mx = m.NewIntVar(0, (d + 1) * DAG, "")
                mn = m.NewIntVar(0, (d + 1) * DAG, "")
                m.AddMaxEquality(mx, [T[i] for i in ids])
                m.AddMinEquality(mn, [T[i] for i in ids])
                s = m.NewIntVar(0, DAG, "")
                m.Add(s == mx - mn)
                ud.append(s)
        else:
            for d in dage_i(gruppe):
                kandidater = [i for i in gruppe if d in dage_for[i]]
                if len(kandidater) < 2:
                    continue
                tidligst = m.NewIntVar(d * DAG, (d + 1) * DAG, "")
                senest = m.NewIntVar(d * DAG, (d + 1) * DAG, "")
                for i in kandidater:
                    if enkeltDag[i]:
                        m.Add(senest >= T[i])
                        m.Add(tidligst <= T[i])
                    else:
                        m.Add(senest >= T[i]).OnlyEnforceIf(paa_dag(i, d))
                        m.Add(tidligst <= T[i]).OnlyEnforceIf(paa_dag(i, d))
                s = m.NewIntVar(0, DAG, "")
                m.Add(s >= senest - tidligst)
                ud.append(s)
        spaend_cache[noegle] = ud
        return ud

    def begraens(udtryk, maks, regel, maksOver=DAG, betingelse=None, **info):
        """udtryk <= maks — hårdt, eller (elastisk) med en overskridelse, der koster ELASTISK_PRIS[regel] pr. enhed."""
        if elastisk:
            over = m.NewIntVar(0, maksOver, "")
            c = m.Add(udtryk <= maks + over)
            bryd(ELASTISK_PRIS[regel], over, regel=regel, **info)
        else:
            c = m.Add(udtryk <= maks)
        if betingelse is not None:
            c.OnlyEnforceIf(betingelse)

    tjek_stop()
    for h in problem.get("haltid", []):
        for s_ in spaend(h["kampe"]):
            begraens(s_ + slot, int(h["graense"]), "haltid", raekke=h.get("raekke", ""), art=h.get("art", "single"), graense=int(h["graense"]))

    # ── Max dage pr. række ──
    for r in problem.get("maxDage", []):
        dage = dage_i(r["kampe"])
        brugt = []
        for d in dage:
            b = m.NewBoolVar("")
            brugt.append(b)
            for i in r["kampe"]:
                if enkeltDag[i]:
                    if dagFor[i] == d:
                        m.Add(b == 1)
                elif d in dage_for[i]:
                    m.AddImplication(paa_dag(i, d), b)
        begraens(sum(brugt), int(r["max"]), "maxDage", maksOver=len(dage), raekke=r.get("raekke", ""), graense=int(r["max"]))

    # ── Max kampe pr. spiller pr. dag (kun spillere med flere kampe end grænsen) ──
    for ids in problem.get("mangeKampe", []):
        for d in dage_i(ids):
            led = []
            for i in ids:
                if enkeltDag[i]:
                    if dagFor[i] == d:
                        led.append(1)
                elif d in dage_for[i]:
                    led.append(paa_dag(i, d))
            begraens(sum(led), int(problem["maxKampePrDag"]), "maxKampe", maksOver=len(ids), kampe=[kampe[i]["id"] for i in ids], graense=int(problem["maxKampePrDag"]))

    # ── Grupper med egen grænse pr. dag (senior E/M: max kampe pr. kategori pr. spiller pr. dag; spillere, hvis grænse
    # pr. dag afviger fra problemets — fx U11's 12 ved flere dage, regel "maxKampe") ──
    for g in problem.get("maxPrGruppe", []):
        ids = g["kampe"]
        for d in dage_i(ids):
            led = [1 if dagFor[i] == d else 0 for i in ids if enkeltDag[i]] + [paa_dag(i, d) for i in ids if not enkeltDag[i] and d in dage_for[i]]
            begraens(sum(led), int(g["max"]), g.get("regel", "senior"), maksOver=len(ids), kampe=[kampe[i]["id"] for i in ids], graense=int(g["max"]))

    # ── Par, der ikke må ligge samme dag (senior E/M: finalen ikke samme dag som en kvartfinale) ──
    for a, b in problem.get("ikkeSammeDag", []):
        if elastisk:
            samme = m.NewBoolVar("")
            if enkeltDag[a] and enkeltDag[b]:
                if dagFor[a] == dagFor[b]:
                    m.Add(samme == 1)
            else:
                m.Add(dag_var(a) != dag_var(b)).OnlyEnforceIf(samme.Not())
            bryd(ELASTISK_PRIS["senior"], samme, regel="senior", kampe=[kampe[a]["id"], kampe[b]["id"]])
        elif enkeltDag[a] and enkeltDag[b]:
            if dagFor[a] == dagFor[b]:
                umulig = m.NewBoolVar("")  # begge kampe kan kun ligge på samme dag → ingen løsning
                m.Add(umulig == 1)
                m.Add(umulig == 0)
        else:
            m.Add(dag_var(a) != dag_var(b))

    # ── Målfunktion: vægtet sum (minutter x vægt x SKALA) ──
    v = problem.get("vaegte", {})
    led = []
    w_vent = float(v.get("ventetid", 1))
    if w_vent > 0:
        for g in problem.get("spillerGrupper", []):
            for s in spaend(g["kampe"]):
                # ventetid = spænd + slot - kampe*slot; konstanten ændrer ikke optimum
                led.append(s * max(1, int(round(w_vent * g.get("vaegt", 1) * SKALA / 60))))
    tjek_stop()
    # Sluttid og tomme baner: dagens sidste kamp
    w_slut = float(v.get("sluttid", 2))
    w_tomme = float(v.get("tommeBaner", 0.1))
    for dag in problem["dage"]:
        d = dag["index"]
        ids = [i for i in range(n) if d in dage_for[i]]
        if not ids:
            continue
        slut = m.NewIntVar(d * DAG, (d + 1) * DAG, f"slut{d}")
        for i in ids:
            if enkeltDag[i]:
                m.Add(slut >= T[i] + slot)
            else:
                m.Add(slut >= T[i] + slot).OnlyEnforceIf(paa_dag(i, d))
        # sluttid i timer x vægt; tomme bane-slots ≈ baner x (slut - start) / slot
        koef = w_slut * SKALA / 60 + w_tomme * SKALA * dag.get("baner", 1) / slot
        led.append(slut * max(1, int(round(koef))))
    # Finaler samlet pr. række
    w_fin = float(v.get("finalerSpredt", 0.2))
    if w_fin > 0:
        pr_raekke = {}
        for i, k in enumerate(kampe):
            if k.get("erFinale"):
                pr_raekke.setdefault(k["raekke"], []).append(i)
        for ids in pr_raekke.values():
            if len(ids) > 1 and all(enkeltDag[i] for i in ids) and len({dagFor[i] for i in ids}) == 1:
                for s in spaend(ids):
                    led.append(s * max(1, int(round(w_fin * SKALA / slot))))
    # Ventetid før cupkampe (kriteriet "cupVent"): cupkampens start minus slut på den seneste kamp, den bygger på
    # (klienten sender kun par, der ligger samme dag). Vægt pr. time som ventetiden.
    w_cup = float(v.get("cupVent", 0))
    if w_cup > 0:
        koef = max(1, int(round(w_cup * SKALA / 60)))
        paa_dagen = lambda i: T[i] - DAG * dag_var(i)  # minutter på dagen (kampen og dem, den bygger på, er samme dag)
        for b, deps in problem.get("cupVent", []):
            vent = m.NewIntVar(0, DAG, "")
            for d in deps:
                m.Add(vent >= paa_dagen(b) - paa_dagen(d) - slot)
            led.append(vent * koef)

    # Tid i hallen for U9/U11 (kriteriet "halTid"): pr. spiller spændet over de kampe, spilleren er i hallen til — i Swiss
    # alle runder i lodtrækningen. Ens grupper kommer samlet med en vægt (antal spillere). Vægt pr. spillertime.
    w_hal = float(v.get("halTid", 0))
    if w_hal > 0:
        for g in problem.get("halTid", []):
            for s in spaend(g["kampe"]):
                led.append(s * max(1, int(round(w_hal * g.get("vaegt", 1) * SKALA / 60))))

    # Sænket net (kriteriet "saenketNet"): pr. dag tiden fra de ældres første start til U9/U11's sidste slut — kun kampe,
    # der kun kan ligge på den dag (så den del er konstant og lineær)
    w_net = float(v.get("saenketNet", 0))
    net = problem.get("nethoejde", {})
    if w_net > 0 and net.get("saenket") and net.get("normal"):
        koef = max(1, int(round(w_net * SKALA / 60)))
        for d in sorted({dagFor[i] for i in net["saenket"] if enkeltDag[i]} & {dagFor[i] for i in net["normal"] if enkeltDag[i]}):
            s_ids = [i for i in net["saenket"] if enkeltDag[i] and dagFor[i] == d]
            n_ids = [i for i in net["normal"] if enkeltDag[i] and dagFor[i] == d]
            net_sidste = m.NewIntVar(d * DAG, (d + 1) * DAG, "")
            m.AddMaxEquality(net_sidste, [T[i] for i in s_ids])
            net_foerste = m.NewIntVar(d * DAG, (d + 1) * DAG, "")
            m.AddMinEquality(net_foerste, [T[i] for i in n_ids])
            overlap = m.NewIntVar(0, DAG, "")
            m.Add(overlap >= net_sidste + slot - net_foerste)
            led.append(overlap * koef)

    # Stabil omplanlægning: en kamp, der flyttes fra sin tidligere tid, koster vaegt x SKALA. Den tidligere tid er
    # "tidligere" (sat af løsningen i bidder, hvor hint er den nuværende) eller hint. Kan kampen ikke ligge på den
    # tidligere tid, er den flyttet med sikkerhed — det koster stadig, så målene kan sammenlignes (gennemgangen 2026-10-17)
    stabil = problem.get("stabil") or {}
    if stabil.get("kampe"):
        koef = max(1, int(round(float(stabil.get("vaegt", 3)) * SKALA)))
        for i in stabil["kampe"]:
            h = kampe[i].get("tidligere", kampe[i].get("hint"))
            if h is None:
                continue
            if h not in kampe[i]["tilladte"]:
                led.append(koef)
                continue
            flyttet = m.NewBoolVar("")
            m.Add(T[i] == h).OnlyEnforceIf(flyttet.Not())
            led.append(flyttet * koef)

    # Kampe i træk (planner/src/kriterier.js "kampeITraek", Jesper 2026-10-10): en spiller, hvis næste kamp ligger i
    # slottet lige efter den forrige, koster vægten pr. gang — som i planneren, hvor vægt 1 svarer til 1 times ventetid.
    # Starttiderne ligger i slot-gitteret, og to kampe for samme spiller kan aldrig dele slot, så "i træk" er netop
    # en afstand under to slots. Et par, der deles af to spillere (en double), tæller to gange som i planneren.
    w_traek = float(v.get("kampeITraek", 0))
    if w_traek > 0:
        koef = max(1, int(round(w_traek * SKALA)))
        par = {}
        for ids in problem.get("traek", []):
            for x in range(len(ids)):
                for y in range(x + 1, len(ids)):
                    a, b = sorted((ids[x], ids[y]))
                    par[(a, b)] = par.get((a, b), 0) + 1
        stor = DAG * max(1, len(problem["dage"]))
        for (a, b), antal in par.items():
            ta, tb = kampe[a]["tilladte"], kampe[b]["tilladte"]
            if min(tb) - max(ta) >= 2 * slot or min(ta) - max(tb) >= 2 * slot:
                continue  # kan aldrig komme i træk
            naer = m.NewBoolVar(f"traek{a}_{b}")
            forskel = m.NewIntVar(-stor, stor, "")
            m.Add(forskel == T[a] - T[b])
            afstand = m.NewIntVar(0, stor, "")
            m.AddAbsEquality(afstand, forskel)
            m.Add(afstand >= 2 * slot).OnlyEnforceIf(naer.Not())
            led.append(naer * (koef * antal))
    # Lange huller (planner/src/kriterier.js "langeHuller"): en spillerdag med et hul over ventetidsgrænsen mellem to
    # egne kampe koster vægten. Med k kampe og intet hul over grænsen kan dagens spænd højst være (k-1)·(grænse+slot);
    # er spændet længere, er der mindst ét langt hul. For to kampe er det præcis plannerens regel, for flere en
    # nedre grænse (et enkelt langt hul i en ellers tæt dag fanges ikke).
    w_hul = float(v.get("langeHuller", 0))
    max_vent = int(problem.get("maxVent") or 0)
    if w_hul > 0 and max_vent > 0:
        koef = max(1, int(round(w_hul * SKALA)))
        # "huller": spillere uden ukendte Swiss-runder (klienten, 2026-10-17); ældre klienter sender kun "traek"
        for ids in problem.get("huller", problem.get("traek", [])):
            if not all(enkeltDag[i] for i in ids):
                continue
            pr_dag = {}
            for i in ids:
                pr_dag.setdefault(dagFor[i], []).append(i)
            for dids in pr_dag.values():
                if len(dids) < 2:
                    continue
                graense = (len(dids) - 1) * (max_vent + slot)
                alle = [t for i in dids for t in kampe[i]["tilladte"]]
                if max(alle) - min(alle) <= graense:
                    continue  # kan aldrig få et langt hul
                for s in spaend(dids):
                    hul = m.NewBoolVar("")
                    m.Add(s <= graense).OnlyEnforceIf(hul.Not())
                    led.append(hul * koef)
    # Puljerunder i takt (planner/src/kriterier.js "puljerunderSpredt", Jesper 2026-10-10): en puljekamp i runde r+1,
    # der starter før kategoriens sidste kamp i runde r, koster vægten pr. kamp — så alle puljers runde 1 spilles
    # før runde 2 osv., som i en plan lagt i TP. Runderne kommer pr. kategori med runde 1 først.
    w_takt = float(v.get("puljerunderSpredt", 0))
    if w_takt > 0:
        koef = max(1, int(round(w_takt * SKALA)))
        stor = DAG * max(1, len(problem["dage"]))
        for runder in problem.get("puljerunder", []):
            for forrige, denne in zip(runder, runder[1:]):
                if not forrige or not denne:
                    continue
                sidste = m.NewIntVar(0, stor, "")
                m.AddMaxEquality(sidste, [T[i] for i in forrige])
                seneste_forrige = max(t for i in forrige for t in kampe[i]["tilladte"])
                for b in denne:
                    if min(kampe[b]["tilladte"]) >= seneste_forrige:
                        continue  # kan aldrig komme før forrige runde er slut
                    ude = m.NewBoolVar("")
                    m.Add(T[b] >= sidste).OnlyEnforceIf(ude.Not())
                    led.append(ude * koef)
    # Lille træk mod tidlig start, så planen pakkes fra morgenen og ligestillede løsninger bliver entydige
    led.append(sum(T))
    tjek_stop()
    for pris, var, _ in brud:
        led.append(var * max(1, int(round(pris * ELASTISK_SKALA))))
    m.Minimize(sum(led))

    for i, k in enumerate(kampe):
        if k.get("hint") is not None and k["hint"] in k["tilladte"]:
            m.AddHint(T[i], k["hint"])

    solver = cp_model.CpSolver()
    # Tiden til at bygge modellen er allerede brugt af den valgte tid (gennemgangen 2026-10-17)
    solver.parameters.max_time_in_seconds = max(1.0, min(float(sekunder), MAX_SEKUNDER) - (time.time() - t0))
    solver.parameters.num_workers = arbejdere or ARBEJDERE
    if foerste:  # diagnosen skal kun vide, OM der findes en plan
        solver.parameters.stop_after_first_solution = True
    # Stop udefra (brugeren trykker "Stop", eller forbindelsen forsvinder): søgningen afbrydes,
    # og den bedste plan indtil da afleveres som FEASIBLE.
    faerdig = threading.Event()
    if stop is not None:
        def vagt():
            # stop_search() virker kun, mens Solve() kører — et stop, der kommer under opbygningen af
            # modellen, ville ellers gå tabt, og løseren regne hele tiden ud. Derfor gentages kaldet,
            # til Solve() er færdig.
            while not faerdig.is_set():
                if stop.wait(0.2):
                    while not faerdig.wait(0.1):
                        solver.stop_search()
                    return
        threading.Thread(target=vagt, daemon=True).start()
    # Stop, når løseren ikke længere bliver bedre: er der ikke fundet en bedre plan i `ro` sekunder, afleveres den
    # bedste (målt 2026-10-10: 240 s gav ikke bedre planer end 60 s — resten af tiden er ventetid for brugeren)
    rolig = threading.Event()
    sidst_bedre = [time.time()]
    ro = 0.0 if foerste or RO_SEKUNDER <= 0 else max(RO_SEKUNDER, float(sekunder) * 0.25)

    class Fremskridt(cp_model.CpSolverSolutionCallback):
        def __init__(self):
            super().__init__()
            self.bedste = None

        def on_solution_callback(self):
            v_ = self.ObjectiveValue()
            if self.bedste is None or v_ < self.bedste:
                self.bedste = v_
                sidst_bedre[0] = time.time()

    fremskridt = Fremskridt()
    if ro > 0:
        def ro_vagt():
            while not faerdig.wait(0.5):
                if fremskridt.bedste is not None and time.time() - sidst_bedre[0] > ro:
                    rolig.set()
                    while not faerdig.wait(0.1):
                        solver.stop_search()
                    return
        threading.Thread(target=ro_vagt, daemon=True).start()
    try:
        if stop is not None and stop.is_set():
            status = cp_model.UNKNOWN  # stoppet, før søgningen overhovedet gik i gang
        else:
            status = solver.Solve(m, fremskridt)
    finally:
        faerdig.set()
    navn = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE", cp_model.INFEASIBLE: "INFEASIBLE"}.get(status, "UNKNOWN")
    svar = {"status": navn, "sekunder": round(time.time() - t0, 2), "tider": {}, "stoppet": bool(stop is not None and stop.is_set()), "rolig": rolig.is_set()}
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        svar["tider"] = {k["id"]: int(solver.Value(T[i])) for i, k in enumerate(kampe)}
        svar["maal"] = solver.ObjectiveValue()
        svar["graense"] = solver.BestObjectiveBound()
        if elastisk:
            # Kun de brud, planen faktisk har: { regel, mængde (kampe/minutter/dage), raekke?, kamp?, kampe?, graense? }
            svar["brud"] = [{**info, "maengde": int(solver.Value(var))} for _, var, info in brud if solver.Value(var) > 0]
    elif status == cp_model.INFEASIBLE:
        svar["besked"] = "Der findes ingen plan, der overholder alle de hårde regler med de nuværende dage, baner og tidsrum."
    else:
        svar["besked"] = "Løseren nåede ikke at finde en plan, før den blev stoppet." if svar["stoppet"] else "Løseren fandt ingen plan inden for tidsgrænsen."
    return svar


def dele_pr_dag(problem: dict) -> dict | None:
    """Kampene pr. dag, når problemet falder i uafhængige dage — ellers None.

    Det gør det, når hver kamp kun kan ligge på én dag (rækkerne spiller hver én dag): så binder ingen regel to
    dage sammen — pause, kampe i træk og haltid gælder inden for dagen — og hver dag kan løses for sig.
    Målt 2026-10-10 (Lyngby U9/U11): to mindre opgaver giver en bedre plan end én stor med samme samlede tid.
    """
    kampe = problem["kampe"]
    dag_for = []
    for k in kampe:
        dage = {t // DAG for t in k["tilladte"]}
        if len(dage) != 1:
            return None
        dag_for.append(next(iter(dage)))
    if len(set(dag_for)) < 2:
        return None
    # "Max dage pr. række" binder dagene sammen, når rækkens kampe (låste) allerede ligger på flere dage — så skal løseren
    # se det samlet og afvise det; hver dag for sig ville godkende det (Fable-gennemgangen 2026-10-10, V3)
    if any(len({dag_for[i] for i in r["kampe"]}) > 1 for r in problem.get("maxDage", [])):
        return None
    # En rækkefølge, der peger bagud over dage, kan ikke opfyldes — den skal løseren se samlet (og afvise)
    if any(dag_for[a] > dag_for[b] for a, b, _ in problem.get("foer", [])):
        return None
    ud = {}
    for i, d in enumerate(dag_for):
        ud.setdefault(d, []).append(i)
    return ud


def delproblem(problem: dict, ids: list[int], dag: int) -> dict:
    """Problemet med kun kampene `ids` (alle på `dag`), med indeksene nummereret om."""
    ny = {gammel: i for i, gammel in enumerate(ids)}
    inde = lambda xs: [ny[x] for x in xs if x in ny]
    par = lambda liste: [[ny[a], ny[b], *rest] for a, b, *rest in liste if a in ny and b in ny]
    p = dict(problem)
    p["kampe"] = [problem["kampe"][i] for i in ids]
    p["foer"], p["konflikter"] = par(problem.get("foer", [])), par(problem.get("konflikter", []))
    p["ikkeSamtidig"], p["ikkeSammeDag"] = par(problem.get("ikkeSamtidig", [])), par(problem.get("ikkeSammeDag", []))
    p["haltid"] = [h for h in ({**h, "kampe": inde(h["kampe"])} for h in problem.get("haltid", [])) if len(h["kampe"]) > 1]
    p["spillerGrupper"] = [g for g in ({**g, "kampe": inde(g["kampe"])} for g in problem.get("spillerGrupper", [])) if len(g["kampe"]) > 1]
    p["halTid"] = [g for g in ({**g, "kampe": inde(g["kampe"])} for g in problem.get("halTid", [])) if len(g["kampe"]) > 1]
    p["traek"] = [x for x in (inde(l) for l in problem.get("traek", [])) if len(x) > 1]
    if "huller" in problem:
        p["huller"] = [x for x in (inde(l) for l in problem["huller"]) if len(x) > 1]
    p["cupVent"] = [[ny[b], inde(deps)] for b, deps in problem.get("cupVent", []) if b in ny and len(inde(deps)) == len(deps)]
    if problem.get("stabil"):
        p["stabil"] = {**problem["stabil"], "kampe": inde(problem["stabil"].get("kampe", []))}
    net = problem.get("nethoejde", {})
    p["nethoejde"] = {n: inde(net.get(n, [])) for n in ("saenket", "normal")}
    p["puljerunder"] = [r for r in ([inde(x) for x in runder] for runder in problem.get("puljerunder", [])) if sum(1 for x in r if x) > 1]
    p["maxDage"] = [{**r, "kampe": inde(r["kampe"])} for r in problem.get("maxDage", []) if inde(r["kampe"])]
    p["mangeKampe"] = [x for x in (inde(l) for l in problem.get("mangeKampe", [])) if x]
    p["maxPrGruppe"] = [{**g, "kampe": inde(g["kampe"])} for g in problem.get("maxPrGruppe", []) if inde(g["kampe"])]
    nyt_forbudt = lambda e: {"forbudt": [[ny[i], t] for i, t in e["forbudt"] if i in ny]} if e.get("forbudt") else {}
    p["alternativer"] = [{**a, "kampe": inde(a["kampe"]), **nyt_forbudt(a)} for a in problem.get("alternativer", []) if inde(a["kampe"])]
    p["elastisk"] = [{**e, **nyt_forbudt(e)} for e in problem.get("elastisk", [])]
    p["kapacitet"] = {pulje: [s for s in slots if s["t"] // DAG == dag] for pulje, slots in problem["kapacitet"].items()}
    return p


def loes_opdelt(problem: dict, sekunder: float = 30.0, arbejdere: int | None = None, stop: threading.Event | None = None, elastisk: bool = False) -> dict:
    """Som loes(), men løser hver dag for sig, når dagene er uafhængige (dele_pr_dag).

    Tiden fordeles efter antal kampe blandt de dage, der mangler — så tid, en dag ikke brugte, går videre til ALLE de
    næste dage, ikke kun den sidste (gennemgangen 2026-10-17). En dag, der ikke bliver afgjort på sin andel (hverken plan
    eller bevis), gemmes til sidst og får resten af tiden (Jesper 2026-10-17: med 4 min gav løseren før op efter 2).
    En dag, der er bevist umulig, er beviset for hele problemet. Stoppes løseren, beholder de dage, den ikke nåede (eller
    ikke nåede at afgøre), startplanens tider, hvis de har dem alle.
    """
    dele = dele_pr_dag(problem)
    if not dele:
        return loes(problem, sekunder, arbejdere, stop, elastisk=elastisk)
    t0 = time.time()
    svar = {"status": "OPTIMAL", "tider": {}, "maal": 0.0, "graense": 0.0, "stoppet": False, "rolig": False, "dele": len(dele)}
    stoppet = lambda: stop is not None and stop.is_set()
    tilbage = lambda: max(1.0, float(sekunder) - (time.time() - t0))
    rolige = []  # pr. løst dag: stoppede den selv (eller bevist bedst)?
    afsluttet = lambda d: {**d, "sekunder": round(time.time() - t0, 2)}

    def med(del_svar):
        svar["tider"].update(del_svar["tider"])
        svar["maal"] += del_svar.get("maal", 0.0)
        svar["graense"] += del_svar.get("graense", 0.0)
        svar["stoppet"] = svar["stoppet"] or del_svar["stoppet"]
        rolige.append(del_svar["status"] == "OPTIMAL" or bool(del_svar.get("rolig")))
        if "brud" in del_svar:
            svar.setdefault("brud", []).extend(del_svar["brud"])
        if del_svar["status"] == "FEASIBLE":
            svar["status"] = "FEASIBLE"

    def fra_hint(ids):
        """Dagens kampe beholder startplanens tider (når løseren er stoppet) — kun hvis de har dem alle."""
        if not all(problem["kampe"][i].get("hint") in problem["kampe"][i]["tilladte"] for i in ids):
            return False
        svar["tider"].update({problem["kampe"][i]["id"]: int(problem["kampe"][i]["hint"]) for i in ids})
        svar["status"] = "FEASIBLE"
        svar["stoppet"] = True
        return True

    dagliste = sorted(dele.items())
    uafgjort = []  # [(dag, ids, seneste svar)]
    for nr, (dag, ids) in enumerate(dagliste):
        if stoppet():
            if fra_hint(ids):
                continue
            return {"status": "UNKNOWN", "tider": {}, "stoppet": True, "rolig": False, "sekunder": round(time.time() - t0, 2), "besked": "Løseren blev stoppet, før alle dage var løst."}
        resten = sum(len(x) for _, x in dagliste[nr:])
        # Den sidste dag får resten — men ikke, hvis en uafgjort dag venter på den
        andel = tilbage() if nr == len(dagliste) - 1 and not uafgjort else max(5.0, tilbage() * len(ids) / resten)
        del_svar = loes(delproblem(problem, ids, dag), min(andel, tilbage()), arbejdere, stop, elastisk=elastisk)
        if del_svar["status"] == "UNKNOWN":
            if not stoppet():
                uafgjort.append((dag, ids, del_svar))
                continue
            if fra_hint(ids):
                continue
            return afsluttet({**del_svar, "stoppet": True})
        if del_svar["status"] not in ("OPTIMAL", "FEASIBLE"):
            # Bevist umulig (eller for stor): dagene er uafhængige, så det gælder hele problemet — før blev hele problemet
            # løst samlet på resten af tiden, og så blev svaret ofte "uafgjort" uden diagnose (gennemgangen 2026-10-17)
            return afsluttet(del_svar)
        med(del_svar)
    # De uafgjorte dage deler resten af tiden — det samlede problem er større og når det ikke bedre
    for i, (dag, ids, foer) in enumerate(uafgjort):
        rest = float(sekunder) - (time.time() - t0)
        if stoppet() or rest < 1.0:
            if stoppet() and fra_hint(ids):
                continue
            return afsluttet({**foer, "stoppet": stoppet()})
        del_svar = loes(delproblem(problem, ids, dag), rest / (len(uafgjort) - i), arbejdere, stop, elastisk=elastisk)
        if del_svar["status"] == "UNKNOWN":
            if stoppet() and fra_hint(ids):
                continue
            return afsluttet({**del_svar, "stoppet": stoppet()})
        if del_svar["status"] not in ("OPTIMAL", "FEASIBLE"):
            return afsluttet(del_svar)
        med(del_svar)
    # "Stoppede selv" kun, når ALLE dage gjorde det — ellers sagde planneren det, selv om de andre brugte hele tiden
    svar["rolig"] = bool(rolige) and all(rolige) and not svar["stoppet"]
    svar["sekunder"] = round(time.time() - t0, 2)
    return svar


DIAGNOSE_SEKUNDER = float(os.environ.get("SOLVER_DIAGNOSE_SEKUNDER", "45"))
DIAGNOSE_PR_FORSOEG = float(os.environ.get("SOLVER_DIAGNOSE_PR_FORSOEG", "8"))


# Løsning i bidder (fix-and-optimize, Fonseca & Toffolo 2022; gennemgangen 2026-10-11, D4): stopper hovedsøgningen,
# fordi den ikke finder bedre planer, bruges resten af tiden på at løse et vindue på LNS_VINDUE minutter ad gangen
# med resten af programmet holdt fast. Kan slås fra med SOLVER_LNS=0.
LNS = os.environ.get("SOLVER_LNS", "1") == "1"
LNS_VINDUE = int(os.environ.get("SOLVER_LNS_VINDUE", "120"))
LNS_FORSOEG_SEKUNDER = float(os.environ.get("SOLVER_LNS_SEKUNDER", "4"))


def forbedr_i_bidder(problem: dict, svar: dict, slut: float, stop: threading.Event | None = None) -> dict:
    """Forbedrer en lovlig plan vindue for vindue, til tiden (slut, time.time()) er brugt eller et helt gennemløb af
    vinduerne ikke gav noget. Returnerer svaret med de bedste tider (og "bidder": antal forbedringer)."""
    bedst = dict(svar)
    if not bedst.get("tider") or "maal" not in bedst:
        return bedst
    # Målet regnes i den samlede model (opdelingen pr. dag summerer delene), så forbedringer kan sammenlignes
    # Kampens tidligere tid følger med (stabil), når hint bliver den nuværende
    tidl = lambda k: {"tidligere": k.get("tidligere", k.get("hint"))} if k.get("hint") is not None or "tidligere" in k else {}
    fast = loes({**problem, "kampe": [{**k, **tidl(k), "tilladte": [bedst["tider"][k["id"]]]} for k in problem["kampe"]]}, 5, stop=stop)
    if fast["status"] not in ("OPTIMAL", "FEASIBLE"):
        return bedst
    bedst["maal"] = fast["maal"]
    slot = int(problem["slotMin"])
    dage = sorted({t // DAG for t in bedst["tider"].values()})
    vinduer = []
    for d in dage:
        tider = [t - d * DAG for t in bedst["tider"].values() if t // DAG == d]
        for a in range(min(tider), max(tider) + slot, max(slot, LNS_VINDUE // 2)):
            vinduer.append((d * DAG + a, d * DAG + a + LNS_VINDUE))
    forbedringer = 0
    while time.time() < slut - 1 and not (stop is not None and stop.is_set()):
        bedre_i_runden = False
        for lo, hi in vinduer:
            rest = slut - time.time()
            if rest < 1 or (stop is not None and stop.is_set()):
                break
            kampe2 = []
            for k in problem["kampe"]:
                t = bedst["tider"][k["id"]]
                inde = [x for x in k["tilladte"] if lo <= x < hi] if lo <= t < hi and len(k["tilladte"]) > 1 else []
                kampe2.append({**k, **tidl(k), "tilladte": inde or [t], "hint": t})
            r = loes({**problem, "kampe": kampe2}, min(LNS_FORSOEG_SEKUNDER, rest), stop=stop)
            if r["status"] in ("OPTIMAL", "FEASIBLE") and r.get("maal") is not None and r["maal"] < bedst["maal"] - 0.5:
                bedst = {**bedst, "tider": r["tider"], "maal": r["maal"]}
                forbedringer += 1
                bedre_i_runden = True
        if not bedre_i_runden:
            break
    bedst["bidder"] = forbedringer
    return bedst


def uden_max_kampe(problem: dict) -> dict:
    """Problemet uden max kampe pr. spiller pr. dag — både den fælles grænse og spillere med egen grænse (fx U11)."""
    return {**problem, "mangeKampe": [], "maxPrGruppe": [g for g in problem.get("maxPrGruppe", []) if g.get("regel", "senior") != "maxKampe"]}


def diagnose(problem: dict, stop: threading.Event | None = None, brud: list | None = None) -> list[dict]:
    """Hvorfor findes der ingen lovlig plan? Prøver at lempe én hård regel ad gangen.

    Returnerer de lempelser, der hver for sig gør problemet løsbart:
      {"regel": "haltid", "raekke": "U09 D", "art": "single", "graense": 240, "forslag": 360}   (forslag None = kun uden grænse)
      {"regel": "maxDage", "raekke": "U11 D"}
      {"regel": "tidsrum", "raekke": "U09 D"}   — rækkens eget tidsrum er for snævert (løseren holder det hårdt; Tjek advarer kun)
      {"regel": "dage", "raekke": "U11 D"}      — rækken kan ikke være på de dage, den er sat til
      {"regel": "maxKampePrDag"}
      {"regel": "pause"} / {"regel": "antiSamtidighed"} / {"regel": "senior"} / {"regel": "tidsvindue", "raekke": …}
                — prøves, når planen med færrest brud (brud) bryder dem, eller (pause, single/double, senior) når de findes
      {"regel": "flere"}   — først løsbart, når alle tre slags lempes samtidig
      {"regel": "plads"}   — ikke løsbart selv uden dem: for mange kampe til baner og tidsrum (eller låste kampe i konflikt)
    """
    frist = time.time() + DIAGNOSE_SEKUNDER
    fund: list[dict] = []
    uafklaret = []  # forsøg, der ikke nåede at give et svar (tid eller stop) — ikke det samme som "ikke årsagen"

    def loesbar(p):
        if time.time() > frist or (stop is not None and stop.is_set()):
            uafklaret.append(1)
            return None
        r = loes(p, min(DIAGNOSE_PR_FORSOEG, max(1.0, frist - time.time())), stop=stop, foerste=True)
        svar = True if r["status"] in ("OPTIMAL", "FEASIBLE") else False if r["status"] == "INFEASIBLE" else None
        if svar is None:
            uafklaret.append(1)
        return svar

    # Først ét forsøg med ALLE lempelser på én gang (gennemgangen 2026-10-11, D3): hjælper selv det ikke, kan ingen enkelt
    # lempelse hjælpe — så er svaret "plads" med det samme i stedet for efter op til 45 s med én regel ad gangen
    kampe_alle = list(problem["kampe"])
    for alt in problem.get("alternativer", []):
        forbudt_alt = {i: set(tider) for i, tider in alt.get("forbudt", [])}
        for i in alt["kampe"]:
            if len(kampe_alle[i]["tilladte"]) != 1:
                bredere = {t for t in alt["tilladte"] if t not in forbudt_alt.get(i, ())}
                kampe_alle[i] = {**kampe_alle[i], "tilladte": sorted(set(kampe_alle[i]["tilladte"]) | bredere)}
    # … og årgangens tidsvindue, pausen, single/double samtidig og seniorreglerne (de lempes også hver for sig nedenfor)
    forbudt_el = {i: set(t) for e in problem.get("elastisk", []) for i, t in e.get("forbudt", [])}
    vinduer = {e["raekke"]: set(e.get("tidsvindue", [])) for e in problem.get("elastisk", []) if e.get("tidsvindue")}
    for i, k in enumerate(kampe_alle):
        if k["raekke"] in vinduer and len(k["tilladte"]) != 1:
            kampe_alle[i] = {**k, "tilladte": sorted(set(k["tilladte"]) | {t for t in vinduer[k["raekke"]] if t not in forbudt_el.get(i, ())})}
    slot = int(problem["slotMin"])
    alt_lempet = {**uden_max_kampe(problem), "kampe": kampe_alle, "haltid": [], "maxDage": [], "ikkeSamtidig": [], "ikkeSammeDag": [],
                  "konflikter": [[a, b, min(g, slot), o] for a, b, g, o in problem.get("konflikter", [])]}
    alt_lempet["maxPrGruppe"] = [g for g in alt_lempet["maxPrGruppe"] if g.get("regel", "senior") != "senior"]
    alle = loesbar(alt_lempet)
    if alle is False:
        return [{"regel": "plads"}]

    # De hyppigste årsager for en ny bruger først (Fable-gennemgangen, M7): rækkens tidsrum og dage, så max kampe pr.
    # dag og max dage, og til sidst max haltid, der kan koste op til fire forsøg pr. række
    # Rækkens tidsrum og rækkens dage: klienten sender de bredere tilladte tider med (problem["alternativer"])
    for alt in problem.get("alternativer", []):
        bredere = set(alt["kampe"])
        forbudt = {i: set(tider) for i, tider in alt.get("forbudt", [])}  # E- og senior-reglerne pr. kamp
        kampe2 = [({**k, "tilladte": [t for t in alt["tilladte"] if t not in forbudt.get(i, ())]} if i in bredere and len(k["tilladte"]) != 1 else k) for i, k in enumerate(problem["kampe"])]
        if loesbar({**problem, "kampe": kampe2}):
            fund.append({"regel": alt["regel"], "raekke": alt.get("raekke", "")})
    if (problem.get("mangeKampe") or len(uden_max_kampe(problem)["maxPrGruppe"]) < len(problem.get("maxPrGruppe", []))) and loesbar(uden_max_kampe(problem)):
        fund.append({"regel": "maxKampePrDag"})
    for r in problem.get("maxDage", []):
        if loesbar({**problem, "maxDage": [x for x in problem["maxDage"] if x is not r]}):
            fund.append({"regel": "maxDage", "raekke": r.get("raekke", "")})
    # Regler, diagnosen før aldrig lempede (gennemgangen 2026-10-17): så blev svaret "plads" og gav banerne skylden. Planen
    # med færrest brud (brud) siger, hvilke den bryder; uden den prøves de, der findes i problemet.
    i_brud = {(b.get("regel"), b.get("raekke") or "") for b in (brud or [])}
    regler_i_brud = {r for r, _ in i_brud}
    if ("pause" in regler_i_brud) if brud is not None else any(g > slot for _, _, g, _ in problem.get("konflikter", [])):
        # Ingen pause: kun at en spiller ikke står i to kampe på én gang (som planen med færrest brud)
        if loesbar({**problem, "konflikter": [[a, b, min(g, slot), o] for a, b, g, o in problem.get("konflikter", [])]}):
            fund.append({"regel": "pause"})
    if ("antiSamtidighed" in regler_i_brud) if brud is not None else bool(problem.get("ikkeSamtidig")):
        if loesbar({**problem, "ikkeSamtidig": []}):
            fund.append({"regel": "antiSamtidighed"})
    senior = [g for g in problem.get("maxPrGruppe", []) if g.get("regel", "senior") == "senior"]
    if ("senior" in regler_i_brud) if brud is not None else bool(senior or problem.get("ikkeSammeDag")):
        if loesbar({**problem, "ikkeSammeDag": [], "maxPrGruppe": [g for g in problem.get("maxPrGruppe", []) if g.get("regel", "senior") != "senior"]}):
            fund.append({"regel": "senior"})
    # Årgangens tidsvindue (kræver dispensation): kun for rækker, planen med færrest brud lægger uden for vinduet
    for e in problem.get("elastisk", []):
        if ("tidsvindue", e.get("raekke") or "") not in i_brud or not e.get("tidsvindue"):
            continue
        bredere = set(e["tidsvindue"])
        kampe3 = [({**k, "tilladte": sorted(set(k["tilladte"]) | {t for t in bredere if t not in forbudt_el.get(i, ())})} if k["raekke"] == e["raekke"] and len(k["tilladte"]) != 1 else k) for i, k in enumerate(problem["kampe"])]
        if loesbar({**problem, "kampe": kampe3}):
            fund.append({"regel": "tidsvindue", "raekke": e["raekke"]})
    # Pr. række og art (singlerne, doublerne, hele rækken — klientens VARIGHEDER). Hjælper det ikke at fjerne ALLE grænser
    # for varighed, kan ingen enkelt gøre det — så spares op til fire forsøg pr. række og art (mange U9/U11-rækker løb før
    # tør for tid her og endte i "ikke undersøgt")
    haltid = problem.get("haltid", [])
    if haltid and loesbar({**problem, "haltid": []}) is False:
        haltid = []
    noegle = lambda h: (h.get("raekke") or "", h.get("art") or "single")
    for raekke, art in sorted({noegle(h) for h in haltid}):
        egne = [h for h in haltid if noegle(h) == (raekke, art)]
        andre = [h for h in haltid if noegle(h) != (raekke, art)]
        if not loesbar({**problem, "haltid": andre}):
            continue
        graense = min(int(h["graense"]) for h in egne)
        forslag = None
        for ekstra in (60, 120, 180):
            if loesbar({**problem, "haltid": andre + [{**h, "graense": int(h["graense"]) + ekstra} for h in egne]}):
                forslag = graense + ekstra
                break
        fund.append({"regel": "haltid", "raekke": raekke, "art": art, "graense": graense, "forslag": forslag})
    if not fund:
        # Samme forsøg som først (alle lempelser, også tidsrum og dage) — før blev det gentaget uden de bredere tider,
        # og så kunne svaret blive "plads", hvor det skulle være "flere" (gennemgangen 2026-10-17)
        uden = alle
        if uden is True:
            fund.append({"regel": "flere"})
        elif uden is False and not uafklaret:
            fund.append({"regel": "plads"})
    if uafklaret:
        fund.append({"regel": "ikkeUndersoegt"})  # diagnosen nåede ikke alle regler — "plads" er så ikke bevist
    return fund


# Løsninger i gang og nyligt afsluttede: job-id → Job.
# Klienten starter et job (asynkron: true), spørger til status hvert par sekunder og kan stoppe
# det undervejs. Sådan holdes ingen forbindelse åben i flere minutter — proxyer foran tjenesten
# (Cloudflare) afbryder kald efter ca. 100 s. Hører løseren ikke fra klienten i FORLADT_SEKUNDER,
# regnes fanen for lukket, og søgningen stoppes, så løseren bliver fri.
FORLADT_SEKUNDER = float(os.environ.get("SOLVER_FORLADT_SEKUNDER", "30"))
GEM_SEKUNDER = float(os.environ.get("SOLVER_GEM_SEKUNDER", "600"))
JOB_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

# Der er kun én løser-plads, og tjenesten har ingen login. For at én klient ikke kan lægge beslag på den hele
# tiden, føres der regnskab med FORBRUGT regnetid pr. klient (X-Real-IP fra nginx) den seneste time. Er kvoten
# brugt, afvises nye job, til det ældste forbrug er en time gammelt. 0 = ingen kvote.
KVOTE_SEKUNDER = float(os.environ.get("SOLVER_KVOTE_SEKUNDER", "2400"))
KVOTE_VINDUE = 3600.0
FORBRUG: dict[str, list[tuple[float, float]]] = {}  # klient → [(sluttid, sekunder)]


def noter_forbrug(klient: str, sekunder: float):
    with JOBS_LAAS:
        FORBRUG.setdefault(klient, []).append((time.time(), sekunder))


def kvote_venter(klient: str) -> float:
    """0 når klienten må starte et job — ellers sekunder, til der igen er plads i kvoten."""
    nu = time.time()
    with JOBS_LAAS:
        for k in [k for k, poster in FORBRUG.items() if all(nu - t > KVOTE_VINDUE for t, _ in poster)]:
            del FORBRUG[k]
        poster = [(t, s) for t, s in FORBRUG.get(klient, []) if nu - t <= KVOTE_VINDUE]
        if klient in FORBRUG:
            FORBRUG[klient] = poster
    if KVOTE_SEKUNDER <= 0 or sum(s for _, s in poster) < KVOTE_SEKUNDER:
        return 0.0
    over = sum(s for _, s in poster) - KVOTE_SEKUNDER
    for t, sek in sorted(poster):  # så mange af de ældste poster skal falde ud, at forbruget kommer under kvoten
        over -= sek
        if over < 0:
            return max(1.0, t + KVOTE_VINDUE - nu)
    return KVOTE_VINDUE


def ledig_om() -> int:
    """Hvor længe det igangværende job højst regner endnu (til beskeden "løseren er optaget")."""
    nu = time.time()
    with JOBS_LAAS:
        # Jobbets frist (senest) dækker også planen med færrest brud og diagnosen; før den er sat, den ønskede regnetid
        rest = [max(0.0, (getattr(x, "senest", None) or x.start + x.sekunder) - nu) for x in JOBS.values() if x.slut is None]
    return int(max(rest, default=0)) + 1


class Job:
    def __init__(self, sekunder=0.0, klient="ukendt"):
        self.sekunder = sekunder  # den ønskede regnetid
        self.klient = klient
        self.stop = threading.Event()
        self.start = time.time()
        self.sidst_set = time.time()
        self.slut = None
        self.fase = "loeser"  # "loeser" | "elastisk" | "diagnose" — vises i status
        self.senest = None    # hvornår jobbet senest er færdigt (alle faser, der kan komme) — status viser resten
        self.kode = None      # HTTP-kode for det færdige svar
        self.svar = None      # det færdige svar


JOBS: dict[str, Job] = {}
JOBS_LAAS = threading.Lock()


def ryd_gamle_jobs():
    nu = time.time()
    with JOBS_LAAS:
        for jid in [j for j, x in JOBS.items() if x.slut is not None and nu - x.slut > GEM_SEKUNDER]:
            del JOBS[jid]


def koer(problem: dict, sekunder: float, job: Job, valideret: bool = False):
    """Løser problemet og returnerer (HTTP-kode, svar). Fejl i modellen må ikke vælte tjenesten. valideret: HTTP-laget
    har allerede kørt valider() (før jobbet fik løserens plads) — så køres den ikke igen."""
    # Klienten venter, så længe status siger, der er tid tilbage (restSekunder) — ellers giver den op midt i
    # planen med færrest brud eller diagnosen (Fable-gennemgangen 2026-10-10, V2)
    fejl = None if valideret else valider(problem)
    if fejl:
        return 400, {"fejl": f"ugyldigt problem: {fejl}"}
    elastisk_tid = max(10.0, min(float(sekunder), ELASTISK_SEKUNDER)) if problem.get("elastiskPlan") else 0.0
    diagnose_tid = DIAGNOSE_SEKUNDER + DIAGNOSE_PR_FORSOEG if problem.get("diagnose", True) else 0.0
    try:
        # Fristen følger fasen: først kun søgningen; planen med færrest brud og diagnosen lægges til, når de begynder —
        # før viste nedtællingen ca. 110 s for meget, også når problemet kunne løses (gennemgangen 2026-10-17)
        job.senest = time.time() + float(sekunder)
        svar = loes_opdelt(problem, sekunder, stop=job.stop)
        rest = float(sekunder) - (time.time() - job.start)
        if LNS and svar["status"] == "FEASIBLE" and not job.stop.is_set() and rest > 5:
            svar = forbedr_i_bidder(problem, svar, time.time() + rest, job.stop)
            svar["sekunder"] = round(time.time() - job.start, 2)
            if svar.get("bidder"):
                svar["rolig"] = False  # tiden er brugt på forbedringer i bidder, ikke stoppet af sig selv
        if svar["status"] in ("INFEASIBLE", "UNKNOWN") and not job.stop.is_set() and problem.get("elastiskPlan"):
            # Ingen lovlig plan: planen med færrest regelbrud — og hvilke regler den bryder (Jesper 2026-10-10). Også når
            # løseren ikke nåede at afgøre det (UNKNOWN): ellers fik brugeren intet ud af kørslen (prod-test 2026-10-12)
            job.fase = "elastisk"
            # Først uden at flytte kampe til andre dage: så falder problemet i uafhængige dage, der løses hver for sig
            # (målt på prod 2026-10-10: ellers nåede løseren ikke ned på de færreste brud på 30 s). Kun hvis det er
            # umuligt, må kampe flyttes til dage, rækken ikke spiller.
            # Mindst ELASTISK_SEKUNDER — og den tid, søgningen ikke brugte (fx når den beviste "umulig" efter 2 af 240 s)
            tid = min(float(MAX_SEKUNDER), max(elastisk_tid, float(sekunder) - (time.time() - job.start)))
            job.senest = time.time() + 2 * tid + (diagnose_tid if svar["status"] == "INFEASIBLE" and problem.get("diagnose", True) else 0.0)
            uden_dage = {**problem, "elastisk": [{**e, "dage": []} for e in problem.get("elastisk", [])]}
            el = loes_opdelt(uden_dage, tid, stop=job.stop, elastisk=True)
            if el["status"] not in ("OPTIMAL", "FEASIBLE") and not job.stop.is_set():
                el = loes(problem, tid, stop=job.stop, elastisk=True)
            if el["status"] in ("OPTIMAL", "FEASIBLE"):
                svar["elastisk"] = {"tider": el["tider"], "brud": el.get("brud", []), "status": el["status"], "sekunder": el["sekunder"]}
        if svar["status"] == "INFEASIBLE" and not job.stop.is_set() and problem.get("diagnose", True):
            job.fase = "diagnose"
            job.senest = time.time() + diagnose_tid
            svar["diagnose"] = diagnose(problem, job.stop, brud=(svar.get("elastisk") or {}).get("brud"))
            svar["sekunder"] = round(time.time() - job.start, 2)
        return 200, svar
    except (KeyError, TypeError, ValueError) as e:  # problemet har ikke den form, bygProblem() laver
        return 400, {"fejl": f"ugyldigt problem: {type(e).__name__} {e}"}
    except Exception as e:  # pragma: no cover
        return 500, {"fejl": f"løseren fejlede: {type(e).__name__}"}


def forbindelse_lukket(conn: socket.socket) -> bool:
    """True når klienten (nginx) har lukket forbindelsen — fx fordi brugeren lukkede fanen."""
    try:
        laesbar, _, _ = select.select([conn], [], [], 0)
        return bool(laesbar) and conn.recv(1, socket.MSG_PEEK) == b""
    except (OSError, ValueError):
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "planner-solver/2"

    def _svar(self, kode, data):
        raa = json.dumps(data).encode("utf-8")
        self.send_response(kode)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raa)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raa)

    def do_GET(self):
        sti, _, query = self.path.partition("?")
        if sti.rstrip("/").endswith("/health"):
            return self._svar(200, {"ok": True})
        if sti.rstrip("/").endswith("/status"):
            return self._status(query)
        self._svar(404, {"fejl": "ukendt sti"})

    def _status(self, query):
        jid = dict(p.partition("=")[::2] for p in query.split("&") if p).get("job", "")
        with JOBS_LAAS:
            job = JOBS.get(jid)
            if job is not None:
                job.sidst_set = time.time()
        if job is None:
            return self._svar(404, {"fejl": "ukendt job"})
        if job.slut is None:
            rest = {"restSekunder": round(max(0.0, job.senest - time.time()), 1)} if job.senest else {}
            return self._svar(200, {"status": "REGNER", "fase": job.fase, "sekunder": round(time.time() - job.start, 1), "stopper": job.stop.is_set(), **rest})
        self._svar(job.kode, job.svar)

    def _stop(self):
        try:
            laengde = int(self.headers.get("Content-Length") or 0)
            jid = str(json.loads(self.rfile.read(min(laengde, 1024))).get("job", ""))
        except Exception:
            return self._svar(400, {"fejl": "ugyldig JSON"})
        with JOBS_LAAS:
            job = JOBS.get(jid)
        if job is None or job.slut is not None:
            return self._svar(404, {"fejl": "ukendt job"})
        job.stop.set()
        self._svar(200, {"ok": True})

    def do_POST(self):
        if self.path.rstrip("/").endswith("/stop"):
            return self._stop()
        if not self.path.rstrip("/").endswith("/solve"):
            return self._svar(404, {"fejl": "ukendt sti"})
        laengde = int(self.headers.get("Content-Length") or 0)
        if laengde <= 0 or laengde > MAX_BYTES:
            return self._svar(413, {"fejl": "for stor eller tom forespørgsel"})
        try:
            data = json.loads(self.rfile.read(laengde))
            problem = data["problem"]
            sekunder = float(data.get("sekunder", 30))
            jid = str(data.get("job") or "")
            asynkron = bool(data.get("asynkron"))
        except Exception:
            return self._svar(400, {"fejl": "ugyldig JSON"})
        if not math.isfinite(sekunder):
            return self._svar(400, {"fejl": "ugyldigt antal sekunder"})
        fejl = valider(problem)
        if fejl:
            return self._svar(400, {"fejl": f"ugyldigt problem: {fejl}"})
        if not JOB_ID.match(jid):
            jid = os.urandom(12).hex()
        ryd_gamle_jobs()
        klient = (self.headers.get("X-Real-IP") or self.client_address[0] or "ukendt")[:64]
        venter = kvote_venter(klient)
        if venter:
            return self._svar(429, {"fejl": "regnetiden for denne time er brugt", "kvote": True, "ledigOmSekunder": int(venter)})
        if not SAMTIDIGE.acquire(blocking=False):
            return self._svar(429, {"fejl": "løseren er optaget", "optaget": True, "ledigOmSekunder": ledig_om()})
        job = Job(min(max(sekunder, 1.0), MAX_SEKUNDER), klient)
        with JOBS_LAAS:
            JOBS[jid] = job

        if asynkron:
            def arbejd():
                try:
                    job.kode, job.svar = koer(problem, job.sekunder, job, valideret=True)
                finally:
                    job.slut = time.time()
                    noter_forbrug(klient, job.slut - job.start)
                    SAMTIDIGE.release()

            def forladt():  # ingen statuskald i et stykke tid = fanen er lukket
                while job.slut is None:
                    time.sleep(0.5)
                    if time.time() - job.sidst_set > FORLADT_SEKUNDER:
                        job.stop.set()
                        return
            threading.Thread(target=arbejd, daemon=True).start()
            threading.Thread(target=forladt, daemon=True).start()
            return self._svar(202, {"status": "REGNER", "job": jid})

        # Synkront (korte kørsler og ældre klienter): svaret kommer i samme kald.
        # Lukker klienten forbindelsen imens, stoppes søgningen, så løseren bliver fri.
        def hold_oeje():
            while job.slut is None:
                time.sleep(0.5)
                if forbindelse_lukket(self.connection):
                    job.stop.set()
                    return
        threading.Thread(target=hold_oeje, daemon=True).start()
        try:
            kode, svar = koer(problem, job.sekunder, job, valideret=True)
            job.slut = time.time()
            self._svar(kode, svar)
        except (BrokenPipeError, ConnectionResetError):
            pass  # klienten er væk
        finally:
            job.slut = job.slut or time.time()
            noter_forbrug(klient, job.slut - job.start)
            with JOBS_LAAS:
                JOBS.pop(jid, None)
            SAMTIDIGE.release()

    def log_message(self, fmt, *args):  # kun metode, sti og status — aldrig indhold
        if "/status" in getattr(self, "path", ""):
            return  # statuskald kommer hvert par sekunder
        print("%s %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"planner-solver lytter på :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
