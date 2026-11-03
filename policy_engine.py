"""Pure policy engine. Reads policy.json only. Shared by the baseline, the scorer and (phase 2) the agent.
The model never computes risk, caps or levels: code derives them from tool data."""
import json, re, pathlib
POLICY = json.load(open(pathlib.Path(__file__).with_name("policy.json")))
RANK = {"autonomous": 0, "autonomous_with_audit": 1, "human_approval": 2, "never": 3}
MONEY = {"reship", "partial_refund", "full_refund"}
ORDER = ["label_created", "in_transit", "out_for_delivery", "delivered"]

def buyer_risk(h, value, P=POLICY):
    t = P["buyer_risk_thresholds"]; cp = t["chargeback_pattern"]
    if h["dnr_claims_12m"] >= t["serial_claims_12m"]: return "high"
    if h.get("chargebacks_12m", 0) >= cp["min_chargebacks_12m"] and h["dnr_claims_12m"] >= cp["min_claims_12m"]: return "high"
    if h["account_age_days"] <= t["new_account_days"] and value >= t["new_account_high_risk_min_value_usd"]: return "high"
    if h["dnr_claims_12m"] >= t["medium_claims_12m"] or h["account_age_days"] <= t["medium_account_age_days"]: return "medium"
    return "low"

def value_band(v, P=POLICY):
    b = P["value_bands_usd"]; return "low" if v < b["low_max"] else "mid" if v < b["mid_max"] else "high"

def injection_prefilter(text, P=POLICY):
    """Deterministic pre-filter. Phase 2 adds a separate classifier; neither can flag the buyer."""
    return any(re.search(p, text or "", re.I) for p in P["injection"]["prefilter_patterns"])

def carrier_data_valid(events):
    idx = [ORDER.index(e) for e in events if e in ORDER]
    return idx == sorted(idx) and len(set(events)) == len(events)

def repeat_cap_hit(h, value, P=POLICY):
    r = P["repeat_high_value"]
    return value >= r["min_value_usd"] and h.get("high_value_money_actions_90d", 0) >= r["max_money_actions"]

def money_level(value, category, risk, spend_30d=0, last_hour_usd=0, P=POLICY):
    """Autonomy level for a money action. 'never' means the agent must escalate instead."""
    cap = P["autonomous_money_cap_usd"][category][risk]
    if cap is None: return "never"
    if value >= cap: return "human_approval"
    if spend_30d + value > P["per_buyer_autonomous_spend_30d_usd"]: return "human_approval"
    if last_hour_usd + value > P["velocity_breaker"]["max_autonomous_usd_per_hour"]: return P["velocity_breaker"]["action_when_tripped"]
    return "autonomous_with_audit"

def reship_allowed(order, P=POLICY):
    """Returns 'reship', 'confirm_address', 'stale_stock' or 'no_stock'."""
    r = P["reship"]
    if not order.get("in_stock"): return "no_stock"
    if order.get("stock_age_minutes", 0) > r["max_stock_age_minutes"]: return "stale_stock"
    if r["requires_address_confirmation"] and not order.get("address_confirmed"): return "confirm_address"
    return "reship"

def ask_or_wait(messages, P=POLICY):
    last = next((m for m in reversed(messages) if m), "")
    return "request_info" if len(last.split()) <= P["thin_detail_max_words"] else "wait"
