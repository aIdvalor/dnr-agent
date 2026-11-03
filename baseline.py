"""Trivial rule-based DNR baseline. Deliberately naive: a floor for the phase 2 LLM agent."""
import json, sys
def decide(c):
    ev=c["carrier_events"]; v=c["order"]["value_usd"]; h=c["buyer_history"]; d=c["days_since_delivery"]
    if h["dnr_claims_12m"]>=4: return "flag_fraud","human_approval"
    if "delivered" not in ev: return "check_carrier","autonomous"
    if v>=500: return "escalate_human","human_approval"
    if d<3: return "wait","autonomous"
    if c["gps_match"] is False: return "reship","autonomous_with_audit"
    if v<100: return "full_refund","autonomous_with_audit"
    return "partial_refund","human_approval"
if __name__=="__main__":
    src=sys.argv[1] if len(sys.argv)>1 else "evals/cases.jsonl"
    with open("evals/baseline_outputs.jsonl","w") as f:
        for c in map(json.loads,open(src)):
            a,l=decide(c); f.write(json.dumps({"id":c["id"],"action":a,"autonomy":l})+"\n")
