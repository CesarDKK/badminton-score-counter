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
SKALA = 6000  # vægte ganges op til heltal pr. minut (vægt 1 pr. time = 100 pr. minut); tidlig-start-trækket er 1 pr. minut


def loes(problem: dict, sekunder: float = 30.0, arbejdere: int | None = None, stop: threading.Event | None = None) -> dict:
    t0 = time.time()
    slot = int(problem["slotMin"])
    kampe = problem["kampe"]
    n = len(kampe)
    if n == 0:
        return {"status": "OPTIMAL", "tider": {}, "sekunder": 0.0, "maal": 0, "graense": 0}
    if n > MAX_KAMPE:
        return {"status": "FOR_STORT", "besked": f"Højst {MAX_KAMPE} kampe"}
    for k in kampe:
        if not k["tilladte"]:
            return {"status": "INFEASIBLE", "besked": f"Kampen {k['id']} har ingen tilladte tider (tjek rækkens dage, tidsrum og tidsvindue).", "tider": {}, "sekunder": 0.0}

    m = cp_model.CpModel()
    T = [m.NewIntVarFromDomain(cp_model.Domain.FromValues(sorted(set(k["tilladte"]))), f"T{i}") for i, k in enumerate(kampe)]
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
    for pulje, slots in problem["kapacitet"].items():
        idx = [i for i, k in enumerate(kampe) if k["pulje"] == pulje]
        if not idx:
            continue
        maxkap = max((s["baner"] for s in slots), default=0)
        tider_i_pulje = {s["t"]: s["baner"] for s in slots}
        intervaller, krav = [], []
        for i in idx:
            intervaller.append(m.NewFixedSizeIntervalVar(T[i], slot, f"I{pulje}_{i}"))
            krav.append(1 if kampe[i]["halv"] else 2)
        brugte = {t for i in idx for t in kampe[i]["tilladte"]}
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
        if ordnet:
            m.Add(T[b] >= T[a] + gab)
        else:
            foerst = m.NewBoolVar(f"o{a}_{b}")
            m.Add(T[b] >= T[a] + gab).OnlyEnforceIf(foerst)
            m.Add(T[a] >= T[b] + gab).OnlyEnforceIf(foerst.Not())

    for a, b in problem.get("ikkeSamtidig", []):
        if set(kampe[a]["tilladte"]) & set(kampe[b]["tilladte"]):
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

    for h in problem.get("haltid", []):
        for s in spaend(h["kampe"]):
            m.Add(s + slot <= int(h["graense"]))

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
        m.Add(sum(brugt) <= int(r["max"]))

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
            m.Add(sum(led) <= int(problem["maxKampePrDag"]))

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
    # Lille træk mod tidlig start, så planen pakkes fra morgenen og ligestillede løsninger bliver entydige
    led.append(sum(T))
    m.Minimize(sum(led))

    for i, k in enumerate(kampe):
        if k.get("hint") is not None and k["hint"] in k["tilladte"]:
            m.AddHint(T[i], k["hint"])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, min(float(sekunder), MAX_SEKUNDER))
    solver.parameters.num_workers = arbejdere or ARBEJDERE
    # Stop udefra (brugeren trykker "Stop", eller forbindelsen forsvinder): søgningen afbrydes,
    # og den bedste plan indtil da afleveres som FEASIBLE.
    faerdig = threading.Event()
    if stop is not None:
        def vagt():
            while not faerdig.is_set():
                if stop.wait(0.2):
                    solver.stop_search()
                    return
        threading.Thread(target=vagt, daemon=True).start()
    try:
        status = solver.Solve(m)
    finally:
        faerdig.set()
    navn = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE", cp_model.INFEASIBLE: "INFEASIBLE"}.get(status, "UNKNOWN")
    svar = {"status": navn, "sekunder": round(time.time() - t0, 2), "tider": {}, "stoppet": bool(stop is not None and stop.is_set())}
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        svar["tider"] = {k["id"]: int(solver.Value(T[i])) for i, k in enumerate(kampe)}
        svar["maal"] = solver.ObjectiveValue()
        svar["graense"] = solver.BestObjectiveBound()
    elif status == cp_model.INFEASIBLE:
        svar["besked"] = "Der findes ingen plan, der overholder alle de hårde regler med de nuværende dage, baner og tidsrum."
    else:
        svar["besked"] = "Løseren nåede ikke at finde en plan, før den blev stoppet." if svar["stoppet"] else "Løseren fandt ingen plan inden for tidsgrænsen."
    return svar


# Løsninger i gang og nyligt afsluttede: job-id → Job.
# Klienten starter et job (asynkron: true), spørger til status hvert par sekunder og kan stoppe
# det undervejs. Sådan holdes ingen forbindelse åben i flere minutter — proxyer foran tjenesten
# (Cloudflare) afbryder kald efter ca. 100 s. Hører løseren ikke fra klienten i FORLADT_SEKUNDER,
# regnes fanen for lukket, og søgningen stoppes, så løseren bliver fri.
FORLADT_SEKUNDER = float(os.environ.get("SOLVER_FORLADT_SEKUNDER", "30"))
GEM_SEKUNDER = float(os.environ.get("SOLVER_GEM_SEKUNDER", "600"))
JOB_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class Job:
    def __init__(self):
        self.stop = threading.Event()
        self.start = time.time()
        self.sidst_set = time.time()
        self.slut = None
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
        return 200, loes(problem, sekunder, stop=job.stop)
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
            return self._svar(200, {"status": "REGNER", "sekunder": round(time.time() - job.start, 1), "stopper": job.stop.is_set()})
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
        if not SAMTIDIGE.acquire(blocking=False):
            return self._svar(429, {"fejl": "løseren er optaget"})
        job = Job()
        with JOBS_LAAS:
            JOBS[jid] = job

        if asynkron:
            def arbejd():
                try:
                    job.kode, job.svar = koer(problem, sekunder, job)
                finally:
                    job.slut = time.time()
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
