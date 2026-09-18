"""Tests af CP-SAT-løseren på små håndlavede problemer. Køres med: python -m unittest -v"""
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


if __name__ == "__main__":
    unittest.main()
