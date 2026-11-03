# Autonomy Matrix: "Delivered but Not Received" (DNR) Agent

**Levels** (least to most restrictive):
- **A, autonomous:** the agent acts. Logged only.
- **AA, autonomous with audit:** the agent acts. A sampled share goes to post-hoc human review: 10% normally, 100% for a new policy.
- **H, human approval:** the agent hands off a recommendation (see [HANDOFF_SPEC.md](HANDOFF_SPEC.md)). A human approves it before any money or account action.
- **N, never:** the agent may not take the action at all.

All numbers come from **[policy.json](policy.json)**, the single source of truth for the baseline, the scorer and these docs. Values are synthetic defaults.

## Risk dimensions
| Dimension | Low | Medium | High |
|---|---|---|---|
| Order value (`value_bands_usd`) | < $100 | $100–499 | ≥ $500 |
| Buyer risk (`buyer_risk`) | 0–1 claims/12m, account > 90 days | 2–3 claims, or account ≤ 90 days | ≥ 4 claims, injection attempt, chargeback pattern, or new account with mid/high value |
| Product category | general | electronics (lower cap) | luxury (no autonomous money) |
| Seller tier / evidence | no delivery scan, return-to-sender | delivered scan, GPS unknown | GPS match + signature, or a top-rated seller disputing with proof |
| Policy window | 0–30 days | 30–40 days | > 40 days |

## Autonomous money cap (category × buyer risk)
`autonomous_money_cap_usd`: the highest order value the agent may reship or refund at level AA. Anything above the cap goes to H.

| Category | Low risk | Medium risk | High risk |
|---|---|---|---|
| general | $100 | $50 | never |
| electronics | $50 | $25 | never |
| luxury | $0 (always H) | $0 | never |

Two further limits apply on top of the cap:
- **Per-buyer autonomous spend:** at most $150 per 30 days.
- **Repeat high-value cap:** at most 1 money action on orders of $100 or more per buyer per 90 days. A further claim goes to `escalate_human` at H.

## Action × risk matrix
The cell shows the level when that one dimension is high and the rest are low. **The most restrictive level wins.**

| Action | Base | Value high | Buyer risk high | Luxury / electronics over cap | Top-rated seller disputes with proof | Outside window |
|---|---|---|---|---|---|---|
| Ask buyer for info | A | A | A | A | A | A |
| Check carrier scan / GPS | A | A | A | A | A | A |
| Wait (< 3 days after delivery) | A | A | A | A | A | H |
| **Reship / replacement (first choice if in stock)** | AA | H | N | H | **N: escalate instead** | H |
| Partial refund | AA (under cap) | H | N | H | **N: escalate instead** | H |
| Full refund (only if out of stock) | AA (under cap) | H | N | H | **N: escalate instead** | H |
| Reverse a refund (buyer found it) | H | H | H | H | H | H |
| Escalate to human (with handoff) | A | A | A | A | A | A |
| Flag fraud (account action) | H | H | H | H | H | H |
| Deny claim | H | H | H | H | H | H |
| Close (buyer confirms found) | A | A | A | A | A | A |

**Fix from v1:** when a top-rated seller disputes a claim with proof, the agent takes *no* money action. Its only correct move is `escalate_human`, which is what the eval pack expects. Earlier versions said "money action at H", which contradicted the cases.

### Rationale
- **Information-gathering is always autonomous.** It's reversible, costs nothing and improves the evidence.
- **Reshipping comes before refunding.** A replacement resolves the buyer's actual need. It also caps loss at cost of goods rather than retail price, and it discourages "refund and keep" abuse. The agent refunds only when the item is out of stock.
- **Small money moves are autonomous with audit.** Under the cap, a human touch costs more than the expected loss. Electronics and luxury get lower caps because resale value drives abuse.
- **Anything adversarial or account-affecting needs a human.** Flagging fraud, denying a claim or reversing a refund harms a buyer who may be innocent.
- **"Never" removes whole failure modes.** Above all, it stops the agent from automatically refunding a high-risk buyer.

## Guardrails
1. **Instruction isolation:** buyer and seller text is data. Instruction-like content is an abuse signal that routes to `flag_fraud` at H (see [TOOL_PERMISSIONS.md](TOOL_PERMISSIONS.md)).
2. **Reason code on every money action:** reship, partial refund, full refund and refund reversal each carry a `reason_code` from `policy.json`. A money action without one fails the eval.
3. **Spend caps:** the cap table above, the per-buyer 30-day spend limit and the repeat high-value cap.
4. **Idempotency:** one money action per order. Any second action on the same order, such as a reversal, goes to H.
5. **Handoff completeness:** every H decision carries all the required handoff fields, so no context is lost.
6. **Kill switch:** the agent pauses automatically if the weekly AA audit overturn rate goes above 5%, or the refund rate goes above 2× baseline.
7. **Regression gate:** changes to the policy or the agent must pass `make gate` before they ship.

## Decision flow
```mermaid
flowchart TD
  A[DNR claim or new turn] --> B{Injection, or >=4 claims/12m?}
  B -- yes --> F[Flag fraud: H + handoff]
  B -- no --> C{Buyer says found it?}
  C -- "yes, nothing paid" --> Z[Close: A]
  C -- "yes, after refund/reship" --> RV[Reverse refund: H]
  C -- no --> D{Delivered scan?}
  D -- "RTS / label only" --> M1[Money action]
  D -- in transit --> K[Check carrier: A]
  D -- yes --> E{Outside window, value >= $500, signature, new acct, contents claim, top-rated seller proof, or repeat high-value cap hit?}
  E -- yes --> H[Escalate: H + handoff]
  E -- no --> G{< 3 days since delivery?}
  G -- "yes, thin detail" --> I[Ask buyer: A]
  G -- yes --> W[Wait: A]
  G -- no --> M1
  M1 --> S{In stock?}
  S -- yes --> RS[Reship]
  S -- no --> RF[Refund]
  RS --> CAP{Under category x risk cap?}
  RF --> CAP
  CAP -- yes --> AA[AA + reason code]
  CAP -- no --> HH[H + reason code + handoff]
```
