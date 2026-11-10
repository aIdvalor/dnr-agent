/**
 * The only code path that writes a committed (simulated) refund. Called by the human "Confirm" button,
 * never by the model. It re-derives the policy decision from source data and refuses anything that differs.
 */
import type { Claim, World } from './types';
import { Ledger, type LedgerEntry } from './ledger';
import { policyFor } from './data';
import { guardsDisabled } from './ablation';

export type CommitResult =
  | { status: 'committed'; entry: LedgerEntry }
  | { status: 'already_committed'; entry: LedgerEntry }
  | { status: 'rejected'; reason: string; entry?: LedgerEntry };

export function commitRefund(args: { proposalId: string; world: World; claim: Claim; ledger: Ledger; by: string }): CommitResult {
  const { proposalId, world, claim, ledger, by } = args;
  const p = ledger.get(proposalId);
  if (!p) return { status: 'rejected', reason: 'UNKNOWN_PROPOSAL' };
  if (p.status === 'committed') return { status: 'already_committed', entry: { ...p } };
  if (p.status === 'rejected') return { status: 'rejected', reason: `ALREADY_REJECTED:${p.rejectedReason}`, entry: { ...p } };
  if (p.orderId !== claim.orderId) return { status: 'rejected', reason: 'ORDER_MISMATCH', entry: ledger.markRejected(proposalId, 'ORDER_MISMATCH') };

  if (guardsDisabled()) return { status: 'committed', entry: ledger.markCommitted(proposalId, by) };
  // Independent recheck against fresh source data and the current ledger.
  const d = policyFor(world, claim, ledger);
  const why =
    d.outcome !== 'REFUND_ELIGIBLE' ? `POLICY_NOW_${d.outcome}:${d.reasonCode}`
    : d.amountUsd !== p.amountUsd ? `AMOUNT_MISMATCH:${p.amountUsd}!=${d.amountUsd}`
    : d.policyVersion !== p.policyVersion ? 'POLICY_VERSION_CHANGED'
    : null;
  if (why) return { status: 'rejected', reason: why, entry: ledger.markRejected(proposalId, why) };
  return { status: 'committed', entry: ledger.markCommitted(proposalId, by) };
}
