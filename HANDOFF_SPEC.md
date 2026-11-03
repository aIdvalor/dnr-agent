# Human Handoff Spec

Every decision at level H, and every `escalate_human` or `flag_fraud`, emits a handoff object. The reviewer should be able to decide **without reopening the raw ticket**. The required fields live in `evals/handoff_required_fields.json`, and the scorer fails any handoff that is missing one.

| Field | Content |
|---|---|
| `case_id` | Order and ticket IDs |
| `summary` | 1–2 sentences: what is claimed, and why a human is needed |
| `buyer_claim` | The buyer's claim in its latest version, plus how it changed across turns |
| `timeline` | Ordered carrier scans, buyer and seller messages, and the agent's actions, with timestamps |
| `evidence` | GPS match, signature, seller proof, stock status, each marked for/against the claim |
| `risk_signals` | Buyer risk band, claim counts, account age, injection detected, caps hit |
| `policy_refs` | The `policy.json` keys and matrix cells that forced H |
| `agent_actions_taken` | What the agent already did (asked for info, reshipped, etc.), with reason codes |
| `recommended_action` | One of the action set, with amount if it's a money action |
| `confidence` | 0–1, plus the single fact that would most change the recommendation |
| `open_questions` | What the human should check or ask |

Example:
```json
{"case_id":"mt-006","summary":"Buyer received autonomous refund ($28), now says found it at front desk. Reversal needs human.",
 "buyer_claim":"T0 not received -> T1 found at front desk","timeline":["delivered d0","claim d4","refund AA WINDOW_ELAPSED_CLEAN_BUYER","found msg d5"],
 "evidence":{"gps_match":null,"in_stock":false},"risk_signals":{"buyer_risk":"low","claims_12m":0},
 "policy_refs":["reason_code_required_for.reverse_refund","matrix: Reverse a refund = H"],
 "agent_actions_taken":["full_refund (WINDOW_ELAPSED_CLEAN_BUYER)"],"recommended_action":"reverse_refund $28",
 "confidence":0.85,"open_questions":["Is the buyer okay with the charge, or should we waive it as goodwill?"]}
```
Handoffs persist across turns. A conversation that is escalated again carries the earlier handoff forward and adds to it rather than replacing it. The multi-turn "context preserved" cases test this.
