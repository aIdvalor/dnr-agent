# DNR Agent: how much should an AI agent decide on its own when a package goes missing?

A governed resolution agent for "delivered but not received" claims. In this proof of concept, putting a policy engine in charge of every decision **cut unsafe autonomy from 37% to 5%** compared with a naive agent, raised action accuracy to 90%, and brought synthetic fraud loss to $0.

> **⚠️ Proof of concept.** All orders, buyers, sellers and amounts are **synthetic**. The demo's LLM outputs are **hand-written replay stand-ins, not live model calls**. The eval numbers below come from **deterministic rules** (no model in the loop).

## 60-second reviewer path
1. **Problem:** the carrier says "delivered" and the buyer says it never came. Refund everyone and you invite abuse. Deny everyone and you lose good buyers to chargebacks. For a marketplace operator, the real question isn't whether an agent can handle these tickets. It's which decisions the agent may make without a human, and how you prove it stays inside those limits.
2. **Architecture:** code owns every decision. The LLM only reads and writes text.
```mermaid
flowchart LR
  M[Buyer message] --> X["LLM: extract facts<br/>(claim, story, injection suspicion)"]
  T["Mock tools<br/>order · carrier · history"] --> E
  X --> E["Policy engine<br/>pure functions over policy.json"]
  E -->|allowed + blocked actions, autonomy level| W[Typed workflow]
  W -->|under cap| A[Act + audit log]
  W -->|risky| H["Human handoff<br/>approval bound to proposal hash"]
  W --> R[LLM: draft reply<br/>no promises before approval]
```
3. **Governance:** see the [Autonomy matrix](AUTONOMY_MATRIX.md), which assigns each action one of four levels (autonomous / autonomous with audit / human approval / never), and [policy.json](policy.json).
4. **Demo:** [https://aidvalor.github.io/dnr-agent/demo/](https://aidvalor.github.io/dnr-agent/demo/). Locally, open `demo/index.html` (no server needed).
5. **Run the evals with one command:** `python3 evals/gate.py`. It checks that the docs match the policy, runs the baseline and enforces the regression floors. `python3 evals/run_workflow.py && python3 evals/score.py evals/workflow_outputs.jsonl evals/workflow_multiturn_outputs.jsonl` scores the workflow.

## Baseline vs policy-engine workflow (full eval pack: 63 cases + 31 multi-turn turns)
Both columns are **deterministic rules**. For the workflow, a keyword extractor stands in for the LLM extraction step, so these numbers measure the policy engine, not a model.

| Metric | Naive baseline | Policy-engine workflow |
|---|---|---|
| **Unsafe-autonomy rate** (must-not-do, or acting below the required level) | 37.2% | **5.3%** |
| Action accuracy | 57.4% | 90.4% |
| Wrongful money-action rate | 18.1% | 5.3% |
| Fraud loss on abuse cases (synthetic) | $400 | $0 |
| Escalation recall / precision | 54% / 90% | 98% / 94% |
| Injection false positives on benign look-alikes | 3/3 | 3/3 |
| Wrongful fraud flags or denials | 0 | 0 |
| Incomplete handoffs | 40 | 0 |
| First-contact resolution | 35.1% | 41.5% |
| Cost per correct resolution (assumed $0.40 per agent decision, $6 per human touch) | $3.81 | $3.87 |
| Multi-turn conversations fully correct | 1/14 | 9/14 |

**Caveats:**
- The workflow's rules and the eval pack were written by the same author, so expect overfitting. A held-out set is in Next steps.
- Both agents use the same keyword pre-filter for injections, which is why both escalate all 3 benign look-alikes. A separate classifier is the fix.
- Cost stays flat because safer routing sends more cases to humans.

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
- **63 single-turn cases** (`cases.jsonl`): 14 easy, 14 ambiguous, 19 abuse (including 8 prompt-injection variants and repeat high-value claims), 13 edge (including category caps), and 3 benign look-alikes. The look-alikes are legitimate buyers whose text resembles an injection.
- **14 multi-turn conversations** (`multiturn.jsonl`, 31 turns), covering:
  - the buyer changing their story
  - "found it" after a refund or reship
  - escalation handoff with context preserved
  - injection partway through a conversation
  - a seller adding evidence
- **Injection routing:** an instruction-like message puts the ticket on hold and escalates it to a human. It **never** flags the buyer, because text can be planted or quoted innocently. The `injection_false_positive_rate` and `wrongful_flag_or_deny` metrics track the harm a detector can do.

## Metrics: baseline vs agent target
The baseline is measured on the eval pack. **The agent column shows phase 2 targets, not results.**

| Metric | Baseline (rule-based) | **Phase 2 target** |
|---|---|---|
| Unsafe-autonomy rate | 37.2% | **0 failures on the pack** (see limits below) |
| Wrongful money-action rate | 18.1% | **≤ 2%** |
| Fraud loss on abuse cases (synthetic $) | $400 | **$0** |
| Injection false positives on benign look-alikes | 3/3 (100%) | **0/3** |
| Escalation recall / precision | 54% / 90% | **≥ 95% / ≥ 80%** |
| First-contact resolution | 35.1% | **≥ 50%** |
| Action accuracy | 57.4% | **≥ 85%** |
| Incomplete handoffs | 40 | **0** |
| Cost per correct resolution (assumed $0.40 per agent decision, $6 per human touch) | $3.81 | **≤ $3.00** |
| Multi-turn conversations fully correct | 1/14 | **≥ 12/14** |

The baseline's deterministic injection pre-filter catches every attack. It also catches all 3 benign look-alikes. That shows why phase 2 needs a separate classifier behind the pre-filter, and why the pre-filter's result can only ever lead to escalation, never to a flag.

## Statistical limits (read before trusting the numbers)
- **Zero failures in about 60 cases only shows the true unsafe rate is below roughly 5%, at 95% confidence** (the rule of three: 3/n). A claim of "0% unsafe" would need hundreds of cases per risk slice.
- **The pack was written by the policy author,** so it risks overfitting. A held-out set and an adversarial set written by someone else are future work.
- **An LLM agent is nondeterministic,** so a single-run gate can be flaky. Phase 2 needs record/replay for CI and repeated live runs with confidence intervals.
- **The targets were set before any agent results.** At about 40% escalation, cost per resolution is mostly the cost of human touches.

```bash
python3 baseline.py && python3 evals/score.py      # full report -> evals/baseline_report.md
python3 evals/gate.py                              # or: make gate
```

## Regression gate
`evals/gate.py` (or `make gate`, with a CI workflow in `.github/workflows/eval-gate.yml`) reruns the agent and fails if any metric falls past the locked floors in `evals/gate_thresholds.json`. That includes unsafe autonomy, wrongful refunds, fraud loss, missing reason codes, incomplete handoffs and escalation recall. A policy change that loosens a cap is caught before it ships. Floors ratchet up as the agent improves.

## Proof-of-concept demo
Open **`demo/index.html`** directly in a browser; it needs no server. It steps through 3 scenarios: a legitimate claim reshipped autonomously, an injected instruction held and escalated without accusing the buyer, and a human approval voided when the proposal changes.

![demo](demo/shots/desktop-3-approval-voided.png)

- `agent/workflow.py`: a typed workflow. `llm.extract` pulls out facts, `decide()` (built on `policy_engine`) lists the allowed and blocked actions, approvals are bound to a proposal hash, and `llm.draft` writes the reply.
- `agent/tools.py`: read-only mock tools over `agent/fixtures.json`.
- `agent/llm.py`: **replay by default** from `agent/recordings.json`. The committed recordings are hand-authored stand-ins. Live mode runs with `DNR_LIVE=1 OPENAI_API_KEY=… [OPENAI_BASE_URL, DNR_MODEL]`, and adding `DNR_RECORD=1` re-records.
- Rebuild: `python3 demo/build.py && ./demo/shots.sh`

## Consistency
`policy.json` is the single source of truth. `policy_engine.py` derives buyer risk, caps and autonomy levels from it in code, never in the model. `tests_consistency.py` fails the gate if the matrix's thresholds drift from the policy file.

## Phase 2 (planned architecture)
- **A typed Python workflow:** code owns the state machine. The LLM only extracts structured facts (claim type, story change, injection suspicion) and drafts the buyer reply and handoff summary.
- **A pure policy engine** (`policy_engine.py`) shared by the agent and the scorer. Money and account tools are reachable only through the engine.
- **Mock tools** over JSON fixtures, and **record/replay of LLM responses** so CI is free and deterministic.
- A small demo UI on replayed traces.

## Next steps
- Address confirmation before reship, a stale-stock check, and cost-of-goods caps. Keys are stubbed in `policy.json`.
- Recalibrated repeat high-value rule tests, and an hourly dollar-velocity breaker wired into the evals. The breaker is defined in `policy.json` and the engine but has no cases yet.
- Fail-closed cases (tool timeout, bad carrier data, money promised before approval, PII leakage), a held-out set, and a legitimate-buyer harm metric.
- A separate injection classifier, unit tests for the engine, and nightly live runs with confidence intervals.
