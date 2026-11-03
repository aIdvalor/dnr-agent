# DNR Agent: a governed "delivered but not received" resolution agent

**Phase 1: the policy and an eval pack, not a model.** Synthetic data only.

## Problem
Marketplaces see claims where the carrier marks a package "delivered" and the buyer says it never arrived. Refunding everyone invites abuse. Denying everyone loses good buyers, and the losses turn into chargebacks. Most cases are easy, a few are adversarial, and the hard part is telling them apart quickly.

## Why governance matters
An LLM agent can resolve most of these tickets. The real question is *what it may do without a human*. This repo defines that boundary first, then measures it.

| Doc | What it defines |
|---|---|
| [AUTONOMY_MATRIX.md](AUTONOMY_MATRIX.md) | Actions × risk dimensions, each cell autonomous / autonomous with audit / human approval / never, plus guardrails and a decision flow |
| [policy.json](policy.json) | Every dollar limit: category × value band × buyer risk caps, with lower caps for electronics and luxury. Also the repeat high-value cap, reship-first and reason codes |
| [TOOL_PERMISSIONS.md](TOOL_PERMISSIONS.md) | Least-privilege scope per tool, and the Trust & Security rules |
| [HANDOFF_SPEC.md](HANDOFF_SPEC.md) | Exactly what a human receives: summary, evidence, recommended action, confidence |

**The matrix in one line:** gather information freely, reship before refunding, move small money with a reason code and an audit trail, and put anything adversarial, high-value or account-affecting in front of a human with a full handoff.

## Eval pack (`evals/`)
- **60 single-turn cases** (`cases.jsonl`): 14 easy, 14 ambiguous, 19 abuse (including 8 prompt-injection variants and repeat high-value claims), 13 edge (including category caps).
- **14 multi-turn conversations** (`multiturn.jsonl`, 31 turns), covering:
  - the buyer changing their story
  - "found it" after a refund or reship
  - "found it" and then missing again
  - escalation handoff with context preserved
  - injection partway through a conversation
  - a seller adding evidence
- Each case or turn carries the expected action, the expected autonomy level, a must-not-do list and, where needed, a required reason code or handoff.

## Metrics: baseline vs agent target
The baseline is measured on the eval pack. **The agent column shows phase 2 targets, not results.**

| Metric | Baseline (rule-based) | **Phase 2 target** |
|---|---|---|
| Unsafe-autonomy rate (must-not-do, or below the required level) | 44.0% | **0%** |
| Wrongful money-action rate | 16.5% | **≤ 2%** |
| Fraud loss on abuse cases (synthetic $) | $400 | **$0** |
| Escalation recall / precision | 38% / 100% | **≥ 95% / ≥ 80%** |
| Escalation rate | 20.9% | **~40%** (what the pack's mix implies) |
| First-contact resolution | 30.8% | **≥ 50%** |
| Action accuracy | 45.1% | **≥ 85%** |
| Incomplete handoffs | 30 | **0** |
| Cost per correct resolution (assumed $0.40 per agent decision, $6 per human touch) | $3.48 | **≤ $3.00** |
| Multi-turn conversations fully correct | 0/14 | **≥ 12/14** |

The baseline gets every easy case right. It misses injection, signatures, contents claims, changing stories and seller-tier nuance, and its handoffs carry bare fields only. Closing those gaps is phase 2.

```bash
python3 baseline.py && python3 evals/score.py      # full report -> evals/baseline_report.md
python3 evals/gate.py                              # or: make gate
```

## Regression gate
`evals/gate.py` (or `make gate`, with a CI workflow in `.github/workflows/eval-gate.yml`) reruns the agent and fails if any metric falls past the locked floors in `evals/gate_thresholds.json`. That includes unsafe autonomy, wrongful refunds, fraud loss, missing reason codes, incomplete handoffs and escalation recall. A policy change that loosens a cap is caught before it ships. Floors ratchet up as the agent improves.

## Phase 2
- An LLM agent with scoped tools behind a policy layer that enforces `policy.json` outside the model.
- Replace the baseline in the gate, hit the targets above, then ratchet the gate up to them.
- A small demo UI: a ticket view showing the recommendation, cited evidence, the handoff card and approve/override buttons.
- Red-team expansion: more injection variants and longer multi-turn manipulation.
