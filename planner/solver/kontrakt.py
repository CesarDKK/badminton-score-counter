"""Kontrakt-test JS ↔ Python: løser de problemer, tests/kontrakt/kontrakt.mjs har bygget.

    python kontrakt.py <mappe>   → læser problem-*.json, skriver svar-*.json (med diagnose ved INFEASIBLE)
"""
import glob
import json
import os
import sys

import solver

mappe = sys.argv[1] if len(sys.argv) > 1 else "."
filer = sorted(glob.glob(os.path.join(mappe, "problem-*.json")))
if not filer:
    sys.exit(f"ingen problem-*.json i {mappe}")
for sti in filer:
    navn = os.path.basename(sti)[len("problem-"):-len(".json")]
    data = json.load(open(sti, encoding="utf-8"))
    kode, svar = solver.koer(data["problem"], float(data.get("sekunder", 20)), solver.Job())
    if kode != 200:
        sys.exit(f"{navn}: løseren afviste problemet ({kode}): {svar}")
    json.dump(svar, open(os.path.join(mappe, f"svar-{navn}.json"), "w", encoding="utf-8"))
    print(f"{navn}: {svar['status']} på {svar['sekunder']} s", flush=True)
