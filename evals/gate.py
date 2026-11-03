"""Regression gate: exit 1 if eval metrics regress past evals/gate_thresholds.json."""
import json, subprocess, sys
g=json.load(open("evals/gate_thresholds.json"))
subprocess.run([sys.executable,"baseline.py"],check=True)  # swap for the phase 2 agent runner
sys.path.insert(0,"evals"); from score import score
s=score(g["agent_outputs"],g["agent_multiturn_outputs"])["overall"]; bad=[]
for k,v in g["min"].items():
    if s[k]<v-0.0005: bad.append(f"{k} {s[k]:.3f} < min {v}")
for k,v in g["max"].items():
    if s[k]>v+0.0005: bad.append(f"{k} {s[k]:.3f} > max {v}")
print("GATE FAIL:\n  "+"\n  ".join(bad) if bad else "GATE PASS"); sys.exit(1 if bad else 0)
