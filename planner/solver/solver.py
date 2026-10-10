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
ELASTISK_SKALA = 10 ** 7  # et brud til pris 1 vejer mere end alle bløde ønsker tilsammen
ELASTISK_SEKUNDER = float(os.environ.get("SOLVER_ELASTISK_SEKUNDER", "30"))  # tid til planen med færrest brud
RO_SEKUNDER = float(os.environ.get("SOLVER_RO_SEKUNDER", "15"))  # stop efter så længe uden en bedre plan (0 = aldrig)
SKALA = 6000  # vægte ganges op til heltal pr. minut (vægt 1 pr. time = 100 pr. minut); tidlig-start-trækket er 1 pr. minut


def loes(problem: dict, sekunder: float = 30.0, arbejdere: int | None = None, stop: threading.Event | None = None, foerste: bool = False, elastisk: bool = False) -> dict:
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
        for i, k in enumerate(kampe):
            e = pr_raekke.get(k["raekke"])
            if not e or len(base[i]) == 1:
                continue
            for regel in ("tidsrum", "tidsvindue", "dage"):
                for t in e.get(regel, []):
                    if t not in base[i] and t not in ekstra[i]:
                        ekstra[i][t] = regel
        kampe = [({**k, "tilladte": sorted(base[i] | set(ekstra[i]))} if ekstra[i] else k) for i, k in enumerate(kampe)]
    for k in kampe:
        if not k["tilladte"]:
            return {"status": "INFEASIBLE", "besked": f"Kampen {k['id']} har ingen tilladte tider (tjek rækkens dage, tidsrum og tidsvindue).", "tider": {}, "sekunder": 0.0}

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
    enkeltDag = [len({t // DAG for t in k["tilladte"]}) == 1 for k in kampe]
    dagFor = [k["tilladte"][0] // DAG for k in kampe]

    # Dag-variabel kun for kampe, der kan ligge på flere dage
    D = {}
    def dag_var(i):
        if enkeltDag[i]:
            return dagFor[i]
        if i not in D:
            d = m.NewIntVar(min(t // DAG for t in kampe[i]["tilladte"]), max(t // DAG for t in kampe[i]["tilladte"]), f"D{i}")
            m.AddDivisionEquality(d, T[i], DAG)
            D[i] = d
        return D[i]

    # ── Kapacitet pr. pulje: cumulative med faste "blokke" der fylder det, banerne ikke rækker til ──
    # Hel bane = 2, halv bane = 1, kapacitet = 2 x baner. Ækvivalent med hele + ceil(halve/2) <= baner.
    # En kamp fra en række med egne baner, der (elastisk) ligger uden for rækkens tider, spiller på de fælles baner
    pr_pulje = {}  # pulje → [(interval, krav, mulige tider)]
    for i, k in enumerate(kampe):
        krav_i = 1 if k["halv"] else 2
        if i in ude_for and k["pulje"] != "faelles":
            u = ude_for[i]
            pr_pulje.setdefault(k["pulje"], []).append((m.NewOptionalFixedSizeIntervalVar(T[i], slot, u.Not(), f"I{k['pulje']}_{i}"), krav_i, base[i]))
            pr_pulje.setdefault("faelles", []).append((m.NewOptionalFixedSizeIntervalVar(T[i], slot, u, f"Ifaelles_{i}"), krav_i, set(ekstra[i])))
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

    for a, b in problem.get("ikkeSamtidig", []):
        if set(kampe[a]["tilladte"]) & set(kampe[b]["tilladte"]):
            if elastisk:
                samtidig = m.NewBoolVar("")
                m.Add(T[a] != T[b]).OnlyEnforceIf(samtidig.Not())
                bryd(ELASTISK_PRIS["antiSamtidighed"], samtidig, regel="antiSamtidighed", kampe=[kampe[a]["id"], kampe[b]["id"]], raekke=kampe[a]["raekke"])
            else:
                m.Add(T[a] != T[b])

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
            dage = sorted({t // DAG for i in gruppe for t in kampe[i]["tilladte"]})
            for d in dage:
                kandidater = [i for i in gruppe if any(t // DAG == d for t in kampe[i]["tilladte"])]
                if len(kandidater) < 2:
                    continue
                foerste = m.NewIntVar(d * DAG, (d + 1) * DAG, "")
                sidste = m.NewIntVar(d * DAG, (d + 1) * DAG, "")
                for i in kandidater:
                    if enkeltDag[i]:
                        m.Add(sidste >= T[i])
                        m.Add(foerste <= T[i])
                    else:
                        paa = m.NewBoolVar("")
                        m.Add(dag_var(i) == d).OnlyEnforceIf(paa)
                        m.Add(dag_var(i) != d).OnlyEnforceIf(paa.Not())
                        m.Add(sidste >= T[i]).OnlyEnforceIf(paa)
                        m.Add(foerste <= T[i]).OnlyEnforceIf(paa)
                s = m.NewIntVar(0, DAG, "")
                m.Add(s >= sidste - foerste)
                ud.append(s)
        spaend_cache[noegle] = ud
        return ud

    paa_cache = {}
    def paa_dag(i, d):
        """Bool: kamp i ligger på dag d (kun for kampe, der kan ligge på flere dage)."""
        if (i, d) not in paa_cache:
            b = m.NewBoolVar("")
            m.Add(dag_var(i) == d).OnlyEnforceIf(b)
            m.Add(dag_var(i) != d).OnlyEnforceIf(b.Not())
            paa_cache[(i, d)] = b
        return paa_cache[(i, d)]

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

    for h in problem.get("haltid", []):
        gruppe = h["kampe"]
        udloesere = set(h.get("udloesere") or gruppe)
        if udloesere >= set(gruppe):
            for s_ in spaend(gruppe):
                begraens(s_ + slot, int(h["graense"]), "haltid", raekke=h.get("raekke", ""), graense=int(h["graense"]))
            continue
        # Grænsen gælder kun de dage, hvor mindst én udløser (kamp i rækken med grænsen) ligger
        for d in sorted({t // DAG for i in gruppe for t in kampe[i]["tilladte"]}):
            kandidater = [i for i in gruppe if any(t // DAG == d for t in kampe[i]["tilladte"])]
            udl = [i for i in kandidater if i in udloesere]
            if len(kandidater) < 2 or not udl:
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
            if any(enkeltDag[i] for i in udl):
                begraens(senest - tidligst + slot, int(h["graense"]), "haltid", raekke=h.get("raekke", ""), graense=int(h["graense"]))
            else:
                udloest = m.NewBoolVar("")
                m.AddMaxEquality(udloest, [paa_dag(i, d) for i in udl])
                begraens(senest - tidligst + slot, int(h["graense"]), "haltid", betingelse=udloest, raekke=h.get("raekke", ""), graense=int(h["graense"]))

    # ── Max dage pr. række ──
    for r in problem.get("maxDage", []):
        dage = sorted({t // DAG for i in r["kampe"] for t in kampe[i]["tilladte"]})
        brugt = []
        for d in dage:
            b = m.NewBoolVar("")
            brugt.append(b)
            for i in r["kampe"]:
                if enkeltDag[i]:
                    if dagFor[i] == d:
                        m.Add(b == 1)
                else:
                    paa = m.NewBoolVar("")
                    m.Add(dag_var(i) == d).OnlyEnforceIf(paa)
                    m.Add(dag_var(i) != d).OnlyEnforceIf(paa.Not())
                    m.AddImplication(paa, b)
        begraens(sum(brugt), int(r["max"]), "maxDage", maksOver=len(dage), raekke=r.get("raekke", ""), graense=int(r["max"]))

    # ── Max kampe pr. spiller pr. dag (kun spillere med flere kampe end grænsen) ──
    for ids in problem.get("mangeKampe", []):
        dage = sorted({t // DAG for i in ids for t in kampe[i]["tilladte"]})
        for d in dage:
            led = []
            for i in ids:
                if enkeltDag[i]:
                    if dagFor[i] == d:
                        led.append(1)
                else:
                    paa = m.NewBoolVar("")
                    m.Add(dag_var(i) == d).OnlyEnforceIf(paa)
                    m.Add(dag_var(i) != d).OnlyEnforceIf(paa.Not())
                    led.append(paa)
            begraens(sum(led), int(problem["maxKampePrDag"]), "maxKampe", maksOver=len(ids), kampe=[kampe[i]["id"] for i in ids], graense=int(problem["maxKampePrDag"]))

    # ── Grupper med egen grænse pr. dag (senior E/M: max kampe pr. kategori pr. spiller pr. dag) ──
    for g in problem.get("maxPrGruppe", []):
        ids = g["kampe"]
        for d in sorted({t // DAG for i in ids for t in kampe[i]["tilladte"]}):
            led = [1 if dagFor[i] == d else 0 for i in ids if enkeltDag[i]] + [paa_dag(i, d) for i in ids if not enkeltDag[i]]
            begraens(sum(led), int(g["max"]), "senior", maksOver=len(ids), kampe=[kampe[i]["id"] for i in ids], graense=int(g["max"]))

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
    # Sluttid og tomme baner: dagens sidste kamp
    w_slut = float(v.get("sluttid", 2))
    w_tomme = float(v.get("tommeBaner", 0.1))
    for dag in problem["dage"]:
        d = dag["index"]
        ids = [i for i in range(n) if any(t // DAG == d for t in kampe[i]["tilladte"])]
        if not ids:
            continue
        slut = m.NewIntVar(d * DAG, (d + 1) * DAG, f"slut{d}")
        for i in ids:
            if enkeltDag[i]:
                m.Add(slut >= T[i] + slot)
            else:
                paa = m.NewBoolVar("")
                m.Add(dag_var(i) == d).OnlyEnforceIf(paa)
                m.Add(dag_var(i) != d).OnlyEnforceIf(paa.Not())
                m.Add(slut >= T[i] + slot).OnlyEnforceIf(paa)
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
        for ids in problem.get("traek", []):
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
    for pris, var, _ in brud:
        led.append(var * max(1, int(round(pris * ELASTISK_SKALA))))
    m.Minimize(sum(led))

    for i, k in enumerate(kampe):
        if k.get("hint") is not None and k["hint"] in k["tilladte"]:
            m.AddHint(T[i], k["hint"])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, min(float(sekunder), MAX_SEKUNDER))
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
    p["haltid"] = [{**h, "kampe": inde(h["kampe"]), **({"udloesere": inde(h["udloesere"])} if h.get("udloesere") else {})} for h in problem.get("haltid", [])]
    p["haltid"] = [h for h in p["haltid"] if len(h["kampe"]) > 1 and (h.get("udloesere") is None or h["udloesere"])]
    p["spillerGrupper"] = [g for g in ({**g, "kampe": inde(g["kampe"])} for g in problem.get("spillerGrupper", [])) if len(g["kampe"]) > 1]
    p["traek"] = [x for x in (inde(l) for l in problem.get("traek", [])) if len(x) > 1]
    p["puljerunder"] = [r for r in ([inde(x) for x in runder] for runder in problem.get("puljerunder", [])) if sum(1 for x in r if x) > 1]
    p["maxDage"] = [{**r, "kampe": inde(r["kampe"])} for r in problem.get("maxDage", []) if inde(r["kampe"])]
    p["mangeKampe"] = [x for x in (inde(l) for l in problem.get("mangeKampe", [])) if x]
    p["maxPrGruppe"] = [{**g, "kampe": inde(g["kampe"])} for g in problem.get("maxPrGruppe", []) if inde(g["kampe"])]
    p["alternativer"] = [{**a, "kampe": inde(a["kampe"])} for a in problem.get("alternativer", []) if inde(a["kampe"])]
    p["kapacitet"] = {pulje: [s for s in slots if s["t"] // DAG == dag] for pulje, slots in problem["kapacitet"].items()}
    return p


def loes_opdelt(problem: dict, sekunder: float = 30.0, arbejdere: int | None = None, stop: threading.Event | None = None) -> dict:
    """Som loes(), men løser hver dag for sig, når dagene er uafhængige (dele_pr_dag). Tiden fordeles efter antal kampe."""
    dele = dele_pr_dag(problem)
    if not dele:
        return loes(problem, sekunder, arbejdere, stop)
    t0 = time.time()
    n = len(problem["kampe"])
    svar = {"status": "OPTIMAL", "tider": {}, "maal": 0.0, "graense": 0.0, "stoppet": False, "rolig": False, "dele": len(dele)}
    for dag, ids in sorted(dele.items()):
        tilbage = max(1.0, float(sekunder) - (time.time() - t0))
        andel = max(5.0, float(sekunder) * len(ids) / n) if dag != max(dele) else tilbage
        if stop is not None and stop.is_set():
            # Stoppet, før dagen kom til: dens kampe beholder startplanens tider, hvis den har dem alle
            if all(problem["kampe"][i].get("hint") in problem["kampe"][i]["tilladte"] for i in ids):
                svar["tider"].update({problem["kampe"][i]["id"]: int(problem["kampe"][i]["hint"]) for i in ids})
                svar["status"] = "FEASIBLE"
                svar["stoppet"] = True
                continue
            return {**loes(problem, 1, arbejdere, stop), "stoppet": True}
        del_svar = loes(delproblem(problem, ids, dag), min(andel, tilbage), arbejdere, stop)
        if del_svar["status"] not in ("OPTIMAL", "FEASIBLE"):
            # En dag uden lovlig plan: hele problemet løses samlet, så svaret (og diagnosen) bliver som før
            return loes(problem, max(1.0, float(sekunder) - (time.time() - t0)), arbejdere, stop)
        svar["tider"].update(del_svar["tider"])
        svar["maal"] += del_svar.get("maal", 0.0)
        svar["graense"] += del_svar.get("graense", 0.0)
        svar["stoppet"] = svar["stoppet"] or del_svar["stoppet"]
        svar["rolig"] = svar["rolig"] or del_svar.get("rolig", False)
        if del_svar["status"] == "FEASIBLE":
            svar["status"] = "FEASIBLE"
    svar["sekunder"] = round(time.time() - t0, 2)
    return svar


DIAGNOSE_SEKUNDER = float(os.environ.get("SOLVER_DIAGNOSE_SEKUNDER", "45"))
DIAGNOSE_PR_FORSOEG = float(os.environ.get("SOLVER_DIAGNOSE_PR_FORSOEG", "8"))


def diagnose(problem: dict, stop: threading.Event | None = None) -> list[dict]:
    """Hvorfor findes der ingen lovlig plan? Prøver at lempe én hård regel ad gangen.

    Returnerer de lempelser, der hver for sig gør problemet løsbart:
      {"regel": "haltid", "raekke": "U09 D", "graense": 240, "forslag": 360}   (forslag None = kun uden grænse)
      {"regel": "maxDage", "raekke": "U11 D"}
      {"regel": "tidsrum", "raekke": "U09 D"}   — rækkens eget tidsrum er for snævert (løseren holder det hårdt; Tjek advarer kun)
      {"regel": "dage", "raekke": "U11 D"}      — rækken kan ikke være på de dage, den er sat til
      {"regel": "maxKampePrDag"}
      {"regel": "flere"}   — først løsbart, når alle tre slags lempes samtidig
      {"regel": "plads"}   — ikke løsbart selv uden dem: for mange kampe til baner og tidsrum (eller låste kampe i konflikt)
    """
    frist = time.time() + DIAGNOSE_SEKUNDER
    fund: list[dict] = []

    def loesbar(p):
        if time.time() > frist or (stop is not None and stop.is_set()):
            return None
        r = loes(p, min(DIAGNOSE_PR_FORSOEG, max(1.0, frist - time.time())), stop=stop, foerste=True)
        return True if r["status"] in ("OPTIMAL", "FEASIBLE") else False if r["status"] == "INFEASIBLE" else None

    haltid = problem.get("haltid", [])
    for raekke in sorted({h.get("raekke") or "" for h in haltid}):
        egne = [h for h in haltid if (h.get("raekke") or "") == raekke]
        andre = [h for h in haltid if (h.get("raekke") or "") != raekke]
        if not loesbar({**problem, "haltid": andre}):
            continue
        graense = min(int(h["graense"]) for h in egne)
        forslag = None
        for ekstra in (60, 120, 180):
            if loesbar({**problem, "haltid": andre + [{**h, "graense": int(h["graense"]) + ekstra} for h in egne]}):
                forslag = graense + ekstra
                break
        fund.append({"regel": "haltid", "raekke": raekke, "graense": graense, "forslag": forslag})
    for r in problem.get("maxDage", []):
        if loesbar({**problem, "maxDage": [x for x in problem["maxDage"] if x is not r]}):
            fund.append({"regel": "maxDage", "raekke": r.get("raekke", "")})
    # Rækkens tidsrum og rækkens dage: klienten sender de bredere tilladte tider med (problem["alternativer"])
    for alt in problem.get("alternativer", []):
        bredere = set(alt["kampe"])
        kampe2 = [({**k, "tilladte": alt["tilladte"]} if i in bredere and len(k["tilladte"]) != 1 else k) for i, k in enumerate(problem["kampe"])]
        if loesbar({**problem, "kampe": kampe2}):
            fund.append({"regel": alt["regel"], "raekke": alt.get("raekke", "")})
    if problem.get("mangeKampe") and loesbar({**problem, "mangeKampe": []}):
        fund.append({"regel": "maxKampePrDag"})
    if not fund:
        uden = loesbar({**problem, "haltid": [], "maxDage": [], "mangeKampe": []})
        if uden is True:
            fund.append({"regel": "flere"})
        elif uden is False:
            fund.append({"regel": "plads"})
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
        rest = [max(0.0, x.sekunder - (nu - x.start)) for x in JOBS.values() if x.slut is None]
    return int(max(rest, default=0)) + 1


class Job:
    def __init__(self, sekunder=0.0, klient="ukendt"):
        self.sekunder = sekunder  # den ønskede regnetid
        self.klient = klient
        self.stop = threading.Event()
        self.start = time.time()
        self.sidst_set = time.time()
        self.slut = None
        self.fase = "loeser"  # "loeser" | "diagnose" — vises i status
        self.kode = None      # HTTP-kode for det færdige svar
        self.svar = None      # det færdige svar


JOBS: dict[str, Job] = {}
JOBS_LAAS = threading.Lock()


def ryd_gamle_jobs():
    nu = time.time()
    with JOBS_LAAS:
        for jid in [j for j, x in JOBS.items() if x.slut is not None and nu - x.slut > GEM_SEKUNDER]:
            del JOBS[jid]


def koer(problem: dict, sekunder: float, job: Job):
    """Løser problemet og returnerer (HTTP-kode, svar). Fejl i modellen må ikke vælte tjenesten."""
    try:
        svar = loes_opdelt(problem, sekunder, stop=job.stop)
        if svar["status"] == "INFEASIBLE" and not job.stop.is_set() and problem.get("elastiskPlan"):
            # Ingen lovlig plan: planen med færrest regelbrud — og hvilke regler den bryder (Jesper 2026-10-10)
            job.fase = "elastisk"
            el = loes(problem, max(10.0, min(float(sekunder), ELASTISK_SEKUNDER)), stop=job.stop, elastisk=True)
            if el["status"] in ("OPTIMAL", "FEASIBLE"):
                svar["elastisk"] = {"tider": el["tider"], "brud": el.get("brud", []), "status": el["status"], "sekunder": el["sekunder"]}
        if svar["status"] == "INFEASIBLE" and not job.stop.is_set() and problem.get("diagnose", True):
            job.fase = "diagnose"
            svar["diagnose"] = diagnose(problem, job.stop)
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
            return self._svar(200, {"status": "REGNER", "fase": job.fase, "sekunder": round(time.time() - job.start, 1), "stopper": job.stop.is_set()})
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
                    job.kode, job.svar = koer(problem, sekunder, job)
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
            kode, svar = koer(problem, sekunder, job)
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
