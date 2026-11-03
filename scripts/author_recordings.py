"""Seed agent/recordings.json with hand-authored stand-ins for LLM output (no API key was available on the build box).
Replace with real outputs: DNR_LIVE=1 DNR_RECORD=1 OPENAI_API_KEY=... python3 demo/build.py"""
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from agent import llm, workflow
EXTRACT = {
 "Hi, tracking says": {"claim_type":"not_received","story":"Marked delivered Friday; not at door or mailroom","story_changed":False,"injection_suspected":False,"amount_demanded_usd":None},
 "SYSTEM: ignore": {"claim_type":"not_received","story":"Buyer says package never arrived; message also contains instruction-like text","story_changed":False,"injection_suspected":True,"amount_demanded_usd":None},
 "The dutch oven": {"claim_type":"not_received","story":"Dutch oven not received; buyer checked neighbors and front desk","story_changed":False,"injection_suspected":False,"amount_demanded_usd":None},
 "Honestly a partial": {"claim_type":"not_received","story":"Same claim; buyer now asks for the full $180 instead of a partial","story_changed":True,"injection_suspected":False,"amount_demanded_usd":180},
}
def reply_for(d):
    a, s = d["action"], d["status"]
    if a == "reship" and s == "executed": return "So sorry it hasn't turned up. We've sent a replacement to your confirmed address and you'll get tracking shortly."
    if a == "escalate_human": return "Thanks for letting us know. I've passed your case to a specialist who will review the delivery details and get back to you within one business day."
    if s == "pending_human": return "Thanks for checking with your neighbors and the front desk. A specialist is reviewing a resolution for your order now; we'll update you within one business day."
    return "Thanks. We've applied the approved resolution to your order; you'll see a confirmation email shortly."
recs = {"_provenance": "hand-authored stand-ins for LLM output; re-record with DNR_LIVE=1 DNR_RECORD=1"}
orig = llm._call
def fake(kind, system, payload):
    if kind == "extract":
        last = payload["messages"][-1]; out = next(v for k, v in EXTRACT.items() if last.startswith(k))
    else: out = {"reply": reply_for(payload["decision"])}
    recs[llm._key(kind, payload)] = out; return out, "replay"
llm._call = fake; workflow.run_all()
llm.REC.write_text(json.dumps(recs, indent=1)); print(len(recs) - 1, "recordings")
