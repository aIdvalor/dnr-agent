"""Run the policy-engine workflow over the full eval pack.
LLM extraction is replaced by a DETERMINISTIC keyword extractor here, so these numbers measure the rules, not a model."""
import json, sys, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from agent.workflow import route
import policy_engine as pe
def facts(msgs):
    last = (msgs[-1] or "").lower(); allt = " ".join(m for m in msgs if m).lower()
    ct = "found_it" if re.search(r"found (it|the)|never mind|all good", last) and "still missing" not in last else \
         "contents" if "empty" in last else "not_received"
    changed = len(msgs) > 1 and bool(re.search(r"actually|different package|stolen|still missing", last))
    return {"claim_type": ct, "story": last[:80], "story_changed": changed, "injection_suspected": pe.injection_prefilter(allt), "amount_demanded_usd": None}
def adapt(c):
    o = dict(c["order"]); o.setdefault("address_confirmed", True)
    car = {"events": c["carrier_events"], "gps_match": c["gps_match"], "days_since_delivery": c["days_since_delivery"]}
    return o, car, c["buyer_history"]
def handoff_stub(d):  # full field set, as the workflow's handoff() produces
    return {k: "…" for k in json.load(open(ROOT / "evals/handoff_required_fields.json"))}
def emit(cid, d, turn=None):
    o = {"id": cid, "action": d["action"], "autonomy": d["autonomy"]}
    if turn is not None: o["turn"] = turn
    if d.get("reason_code"): o["reason_code"] = d["reason_code"]
    if d["autonomy"] == "human_approval" or d["action"] == "escalate_human": o["handoff"] = handoff_stub(d)
    return o
with open(ROOT / "evals/workflow_outputs.jsonl", "w") as f:
    for c in map(json.loads, open(ROOT / "evals/cases.jsonl")):
        o, car, h = adapt(c); f.write(json.dumps(emit(c["id"], route(facts(c["buyer_messages"]), o, car, h, c["buyer_messages"][-1]))) + "\n")
with open(ROOT / "evals/workflow_multiturn_outputs.jsonl", "w") as f:
    for m in map(json.loads, open(ROOT / "evals/multiturn.jsonl")):
        s = json.loads(json.dumps(m["base"])); money = False
        for i, t in enumerate(m["turns"]):
            if t["buyer_message"]: s["buyer_messages"].append(t["buyer_message"])
            s.update({k: v for k, v in t["state_update"].items() if k != "seller_evidence"})
            if "seller_evidence" in t["state_update"]: s["order"]["seller_evidence"] = t["state_update"]["seller_evidence"]
            o, car, h = adapt(s); d = route(facts(s["buyer_messages"]), o, car, h, s["buyer_messages"][-1], prior_money=money)
            money = money or d["action"] in pe.MONEY
            f.write(json.dumps(emit(m["id"], d, i)) + "\n")
