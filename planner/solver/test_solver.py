"""Tests af CP-SAT-løseren på små håndlavede problemer. Køres med: python -m unittest -v"""
import threading
import time
import unittest

from solver import DAG, loes


def problem(kampe, **ekstra):
    p = {
        "version": 1, "slotMin": 30,
        "dage": [{"index": 0, "start": 540, "slut": 720, "baner": 2}],
        "kapacitet": {"faelles": [{"t": t, "baner": 2} for t in range(540, 720, 30)]},
        "kampe": kampe, "foer": [], "konflikter": [], "ikkeSamtidig": [], "haltid": [],
        "spillerGrupper": [], "maxDage": [], "maxKampePrDag": 10, "mangeKampe": [],
        "vaegte": {"ventetid": 1, "sluttid": 2, "tommeBaner": 0.1, "finalerSpredt": 0.2},
    }
    p.update(ekstra)
    return p


def kamp(i, tilladte=None, pulje="faelles", halv=False, raekke="U11 D", **ekstra):
    return {"id": f"k{i}", "raekke": raekke, "pulje": pulje, "halv": halv, "tilladte": list(range(540, 720, 30)) if tilladte is None else tilladte, "spillere": [], "erFinale": False, "hint": None, **ekstra}


class SolverTest(unittest.TestCase):
    def test_kapacitet_og_tidlig_pakning(self):
        r = loes(problem([kamp(i) for i in range(5)]), 5)
        self.assertEqual(r["status"], "OPTIMAL")
        tider = sorted(r["tider"].values())
        self.assertEqual(tider, [540, 540, 570, 570, 600], "to baner: to kampe pr. slot, pakket fra morgenen")

    def test_halve_baner_deler_en_bane(self):
        kampe = [kamp(0, halv=True), kamp(1, halv=True), kamp(2), kamp(3)]
        r = loes(problem(kampe, kapacitet={"faelles": [{"t": t, "baner": 2} for t in range(540, 720, 30)]}), 5)
        self.assertEqual(sorted(r["tider"].values()), [540, 540, 540, 570], "2 halve + 1 hel = 2 baner i første slot")

    def test_konflikt_og_raekkefoelge(self):
        kampe = [kamp(0), kamp(1), kamp(2)]
        r = loes(problem(kampe, konflikter=[[0, 1, 60, 0]], foer=[[1, 2, 30]]), 5)
        t = r["tider"]
        self.assertGreaterEqual(abs(t["k0"] - t["k1"]), 60)
        self.assertGreaterEqual(t["k2"], t["k1"] + 30)

    def test_reserveret_pulje_og_spaerret_kapacitet(self):
        kap = {"faelles": [{"t": t, "baner": 1} for t in range(540, 720, 30)], "U09 D": [{"t": t, "baner": 1 if t >= 600 else 0} for t in range(540, 720, 30)]}
        kampe = [kamp(0, pulje="U09 D", halv=True, raekke="U09 D"), kamp(1, pulje="U09 D", halv=True, raekke="U09 D"), kamp(2), kamp(3)]
        r = loes(problem(kampe, kapacitet=kap), 5)
        t = r["tider"]
        self.assertEqual(r["status"], "OPTIMAL")
        self.assertGreaterEqual(min(t["k0"], t["k1"]), 600, "U9-puljen har først baner fra kl. 10:00")
        self.assertEqual(t["k0"], t["k1"], "to halve deler den ene reserverede bane")
        self.assertEqual(sorted([t["k2"], t["k3"]]), [540, 570], "én fælles bane")

    def test_max_haltid_er_haard(self):
        kampe = [kamp(0), kamp(1), kamp(2)]
        konf = [[0, 1, 60, 0], [1, 2, 60, 0], [0, 2, 60, 0]]
        ok = loes(problem(kampe, konflikter=konf, haltid=[{"kampe": [0, 1, 2], "graense": 150}]), 5)
        self.assertEqual(ok["status"], "OPTIMAL")
        self.assertLessEqual(max(ok["tider"].values()) - min(ok["tider"].values()) + 30, 150)
        umulig = loes(problem(kampe, konflikter=konf, haltid=[{"kampe": [0, 1, 2], "graense": 120}]), 5)
        self.assertEqual(umulig["status"], "INFEASIBLE")
        self.assertIn("ingen plan", umulig["besked"])

    def test_ventetid_minimeres(self):
        # spiller A har kamp 0 og 2; kamp 1 er en anden. Én bane → A's kampe skal ligge med mindst 60 imellem
        kap = {"faelles": [{"t": t, "baner": 1} for t in range(540, 720, 30)]}
        kampe = [kamp(0), kamp(1), kamp(2)]
        r = loes(problem(kampe, kapacitet=kap, konflikter=[[0, 2, 60, 0]], spillerGrupper=[{"kampe": [0, 2], "vaegt": 1}]), 5)
        t = r["tider"]
        self.assertEqual(abs(t["k0"] - t["k2"]), 60, "A's kampe så tæt som pausen tillader")
        self.assertEqual(t["k1"], min(t["k0"], t["k2"]) + 30, "den anden kamp fylder hullet")

    def test_max_dage_og_flere_dage(self):
        tider = list(range(540, 600, 30)) + [DAG + t for t in range(540, 600, 30)]
        kap = {"faelles": [{"t": t, "baner": 1} for t in tider]}
        dage = [{"index": 0, "start": 540, "slut": 600, "baner": 1}, {"index": 1, "start": 540, "slut": 600, "baner": 1}]
        kampe = [kamp(i, tilladte=tider) for i in range(3)]
        fri = loes(problem(kampe, kapacitet=kap, dage=dage), 5)
        self.assertEqual(fri["status"], "OPTIMAL")
        self.assertEqual(len({t // DAG for t in fri["tider"].values()}), 2, "3 kampe på én bane og 2 slots kræver begge dage")
        laast = loes(problem(kampe, kapacitet=kap, dage=dage, maxDage=[{"raekke": "U11 D", "max": 1, "kampe": [0, 1, 2]}]), 5)
        self.assertEqual(laast["status"], "INFEASIBLE")

    def test_laast_kamp_og_tom_tilladt(self):
        r = loes(problem([kamp(0, tilladte=[660]), kamp(1)]), 5)
        self.assertEqual(r["tider"]["k0"], 660)
        tom = loes(problem([kamp(0, tilladte=[])]), 5)
        self.assertEqual(tom["status"], "INFEASIBLE")
        self.assertIn("k0", tom["besked"])


def stort_problem(spillere=40, kampe_pr_spiller=6):
    """Et problem, der er for stort til at blive bevist optimalt på få sekunder."""
    tider = list(range(540, 1080, 30))
    kap = {"faelles": [{"t": t, "baner": 8} for t in tider]}
    kampe, grupper, konflikter = [], {s: [] for s in range(spillere)}, []
    n = 0
    for runde in range(kampe_pr_spiller):
        for a in range(0, spillere, 2):
            b = (a + 1 + 2 * runde) % spillere
            kampe.append(kamp(n, tilladte=tider, spillere=[a, b]))
            grupper[a].append(n)
            grupper[b].append(n)
            n += 1
    for liste in grupper.values():
        for i in range(len(liste)):
            for j in range(i + 1, len(liste)):
                konflikter.append([liste[i], liste[j], 30, 0])
    return problem(kampe, kapacitet=kap, konflikter=konflikter, dage=[{"index": 0, "start": 540, "slut": 1080, "baner": 8}],
                   spillerGrupper=[{"kampe": l, "vaegt": 1} for l in grupper.values()])


class StopTest(unittest.TestCase):
    def test_stop_afbryder_og_afleverer_bedste_plan(self):
        stop = threading.Event()
        threading.Timer(3.0, stop.set).start()
        t0 = time.time()
        r = loes(stort_problem(), 60, stop=stop)
        self.assertLess(time.time() - t0, 15, "søgningen stopper kort efter signalet, ikke efter 60 s")
        if r["status"] != "OPTIMAL":
            self.assertTrue(r["stoppet"])
        self.assertIn(r["status"], ("FEASIBLE", "OPTIMAL"))
        self.assertEqual(len(r["tider"]), 120, "den bedste plan indtil da afleveres")

    def test_uden_stop_er_stoppet_falsk(self):
        r = loes(problem([kamp(0), kamp(1)]), 5)
        self.assertFalse(r["stoppet"])

    def test_http_stop_og_lukket_forbindelse(self):
        import json
        import socket
        import urllib.request
        from http.server import ThreadingHTTPServer
        from solver import Handler
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            def post(sti, data):
                req = urllib.request.Request(f"http://127.0.0.1:{port}{sti}", data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=90) as svar:
                        return svar.status, json.loads(svar.read())
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read())

            # 1) /stop afslutter et job og giver den bedste plan tilbage i det oprindelige kald
            resultat = {}
            traad = threading.Thread(target=lambda: resultat.update(svar=post("/solve", {"problem": stort_problem(), "sekunder": 60, "job": "testjob-12345"})))
            t0 = time.time()
            traad.start()
            time.sleep(3)
            self.assertEqual(post("/stop", {"job": "ukendt-job-999"})[0], 404)
            self.assertEqual(post("/stop", {"job": "testjob-12345"})[0], 200)
            traad.join(30)
            self.assertLess(time.time() - t0, 20)
            kode, svar = resultat["svar"]
            self.assertEqual(kode, 200)
            self.assertEqual(len(svar["tider"]), 120)

            # 2) Lukkes forbindelsen midt i en løsning, bliver løseren fri igen inden tidsgrænsen
            raa = json.dumps({"problem": stort_problem(), "sekunder": 60}).encode()
            s = socket.create_connection(("127.0.0.1", port))
            s.sendall(b"POST /solve HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: " + str(len(raa)).encode() + b"\r\n\r\n" + raa)
            time.sleep(2)
            self.assertEqual(post("/solve", {"problem": problem([kamp(0)]), "sekunder": 5})[0], 429, "optaget, mens den første regner")
            s.close()
            frist = time.time() + 15
            kode = 429
            while kode == 429 and time.time() < frist:
                time.sleep(1)
                kode = post("/solve", {"problem": problem([kamp(0)]), "sekunder": 5})[0]
            self.assertEqual(kode, 200, "løseren blev fri kort efter, at forbindelsen blev lukket")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
