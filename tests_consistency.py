"""Fails if the docs drift from policy.json (single source of truth). Run by the gate."""
import json, sys
P=json.load(open("policy.json")); M=open("AUTONOMY_MATRIX.md").read(); T=P["buyer_risk_thresholds"]
checks={f"account ≤ {T['medium_account_age_days']} days":"medium account age",
 f"account ≤ {T['new_account_days']} days":"new account days",
 f"order ≥ ${T['new_account_high_risk_min_value_usd']}":"new-account high-risk value",
 f"≥ {T['serial_claims_12m']} claims":"serial claims",
 f"> {P['policy_window_days']} days":"policy window",
 f"< {P['wait_days_after_delivery']} days":"wait days",
 f"≤ {P['thin_detail_max_words']} words":"ask-vs-wait rule",
 f"orders of ${P['repeat_high_value']['min_value_usd']} or more":"repeat cap",
 f"< ${P['value_bands_usd']['low_max']} |":"low band", f"≥ ${P['value_bands_usd']['mid_max']} |":"high band",
 f"at most ${P['per_buyer_autonomous_spend_30d_usd']}":"30d spend"}
for cat,row in P["autonomous_money_cap_usd"].items():
    if cat.startswith("_"): continue
    checks[f"| {cat} |"]=f"cap row {cat}"
bad=[v for k,v in checks.items() if k not in M]
assert P["injection"]["routing"]=="escalate_human" and "flag_fraud" in P["injection"]["never"]
print("DOCS CONSISTENT" if not bad else "DOCS DRIFT: "+", ".join(bad)); sys.exit(1 if bad else 0)
