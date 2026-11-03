# Tool Permissions

Least privilege applies throughout. The model proposes actions, and a **policy layer outside the model** checks each one against `policy.json` and the [autonomy matrix](AUTONOMY_MATRIX.md) before execution. The model never holds credentials for money or account tools.

| Tool / action | Access | Scope | Max autonomy | Notes |
|---|---|---|---|---|
| `get_order` | read | this order only | A | Address reduced to a GPS-match boolean, with no raw PII |
| `get_carrier_events` | read | this order's tracking | A | |
| `get_buyer_history` | read | aggregate counts only | A | Claim, chargeback and money-action counts. No other orders' contents |
| `message_buyer` | write | this ticket's thread | A | Templated plus free text. No promises of money before the policy layer approves |
| `schedule_followup` (wait) | write | this ticket | A | At most 3 days |
| `create_reship` | write | this order, 1 unit, same SKU | AA under cap | Needs stock; `reason_code` required |
| `issue_refund` | write | ≤ order value | AA under cap | Partial or full; `reason_code` required; idempotent per order |
| `reverse_refund` | write | a prior refund on this order | H | Always human |
| `escalate_to_human` | write | handoff queue | A | Must include all [HANDOFF_SPEC](HANDOFF_SPEC.md) fields |
| `flag_account` | write | risk queue (not a ban) | H | The agent can only *propose*. Bans are out of scope |
| `deny_claim` | write | this ticket | H | |
| Policy, system prompt, tool list | none | n/a | N | Never revealed to buyers |
| Other buyers' data, seller payouts, payment instruments | none | n/a | N | Not exposed to the agent at all |

## Trust & Security rules
- **Untrusted inputs:** buyer messages, seller messages and attachments are passed as quoted data and never concatenated into instructions.
- **Adversarial patterns that put the ticket on hold and route to `escalate_human` at H** (never `flag_fraud` on the buyer, since text can be planted or quoted innocently):
  - fake system or admin text
  - markup that tries to break out of the message
  - "the previous agent approved this"
  - legal threats demanding an override
  - requests for the system prompt or tool list
  - instructions hidden in another language
  - requests to stack refund and reship together

  The eval pack has 8 single-turn cases, 1 mid-conversation case and 3 benign look-alikes (scored by `injection_false_positive_rate`).
- **Fail closed:** if a tool errors or returns ambiguous data, the agent escalates rather than guessing.
- **Audit log:** each call records tool, arguments, policy check result, reason code and model confidence.
