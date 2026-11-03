"""Trivial rule-based DNR baseline, driven by policy.json. Deliberately naive: a floor for phase 2."""
import json, sys
from policy_engine import POLICY as P, buyer_risk, money_level, injection_prefilter, ask_or_wait
def money(c,action,reason):
    o=c["order"]; lvl=money_level(o["value_usd"],o.get("product_category","general"),buyer_risk(c["buyer_history"],o["value_usd"]))
    if lvl=="never": return "escalate_human","human_approval",None
    if P["reship"]["first_when_in_stock"] and action=="full_refund" and c["order"].get("in_stock"): action="reship"
    return action,lvl,reason
def decide(c):
    ev=c["carrier_events"]; v=c["order"]["value_usd"]; h=c["buyer_history"]; d=c["days_since_delivery"]
    msg=" ".join(m for m in c["buyer_messages"] if m).lower()
    if injection_prefilter(msg): return P["injection"]["routing"],"human_approval",None  # hold + escalate, never flag
    if h["dnr_claims_12m"]>=P["buyer_risk_thresholds"]["serial_claims_12m"]: return "flag_fraud","human_approval",None
    if "found it" in msg or "never mind" in msg: return "close_no_action","autonomous",None
    if "return_to_sender" in ev: return money(c,"full_refund","RETURN_TO_SENDER")
    if "delivered" not in ev: return "check_carrier","autonomous",None
    if v>=P["value_bands_usd"]["mid_max"]: return "escalate_human","human_approval",None
    if d<P["wait_days_after_delivery"]: return ask_or_wait(c["buyer_messages"]),"autonomous",None
    if c["gps_match"] is False: return money(c,"reship","GPS_MISMATCH")
    if v<P["value_bands_usd"]["low_max"]: return money(c,"full_refund","WINDOW_ELAPSED_CLEAN_BUYER")
    return "partial_refund","human_approval","HUMAN_APPROVED_PARTIAL"
def out(cid,a,l,r,turn=None,state=None):
    o={"id":cid,"action":a,"autonomy":l}
    if turn is not None: o["turn"]=turn
    if r: o["reason_code"]=r
    if l=="human_approval" or a=="escalate_human":  # naive handoff: only bare fields
        o["handoff"]={"case_id":cid,"recommended_action":a,"summary":"DNR claim"}
    return o
if __name__=="__main__":
    with open("evals/baseline_outputs.jsonl","w") as f:
        for c in map(json.loads,open("evals/cases.jsonl")):
            f.write(json.dumps(out(c["id"],*decide(c)))+"\n")
    with open("evals/baseline_multiturn_outputs.jsonl","w") as f:
        for m in map(json.loads,open("evals/multiturn.jsonl")):
            s=json.loads(json.dumps(m["base"]))
            for i,t in enumerate(m["turns"]):
                if t["buyer_message"]: s["buyer_messages"].append(t["buyer_message"])
                s.update(t["state_update"])
                f.write(json.dumps(out(m["id"],*decide(s),turn=i))+"\n")
