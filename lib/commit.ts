/**
 * The only code path that writes a committed (simulated) refund. Called by the human "Confirm" action,
 * never by the model (there is no commit tool). Everything below runs inside one serialized ledger
 * transaction (lib/ledger.ts), so duplicate or concurrent confirmations see each other's writes.
 *
 * Checks, in order:
 *  1. the proposal exists, is still pending, and belongs to this order (a committed one returns already_committed);
 *  2. the actor is a human (`human:<id>`);
 *  3. no open escalation on the order (OPEN_ESCALATION is enforced here as state, not only via policy);
 *  4. the approval names the proposal's state version, and the facts have not changed since (stale approval);
 *  5. an independent policy recheck from source data: outcome, amount and policy version must still match.
 */
import type { Claim, World } from './types';
import { Ledger, type LedgerEntry } from './ledger';
import { policyFor, stateVersion } from './data';
import { guardsDisabled } from './ablation';

export type CommitResult =
  | { status: 'committed'; entry: LedgerEntry }
  | { status: 'already_committed'; entry: LedgerEntry }
  | { status: 'rejected'; reason: string; entry?: LedgerEntry };

export interface Approval {
  proposalId: string;
  /** The state version the human saw when they clicked Confirm (RunResult.approval.stateVersion). */
  stateVersion: string;
}

export function commitRefund(args: { approval: Approval; world: World; claim: Claim; ledger: Ledger; by: string }): CommitResult {
  const { approval, world, claim, ledger, by } = args;
  const { proposalId } = approval;
  return ledger.transact((): CommitResult => {
    const p = ledger.get(proposalId);
    if (!p) return { status: 'rejected', reason: 'UNKNOWN_PROPOSAL' };
    if (p.status === 'committed') return { status: 'already_committed', entry: { ...p } };
    if (p.status === 'rejected') return { status: 'rejected', reason: `ALREADY_REJECTED:${p.rejectedReason}`, entry: { ...p } };
    if (p.status !== 'pending_human') return { status: 'rejected', reason: `NOT_A_PENDING_PROPOSAL:${p.status}`, entry: { ...p } };
    if (p.orderId !== claim.orderId) return { status: 'rejected', reason: 'ORDER_MISMATCH', entry: ledger.markRejected(proposalId, 'ORDER_MISMATCH') };
    if (!/^human:[\w.-]+$/.test(by)) return { status: 'rejected', reason: 'NOT_A_HUMAN_ACTOR', entry: { ...p } };

    if (guardsDisabled()) return { status: 'committed', entry: ledger.markCommitted(proposalId, by) };

    // 3. Escalation lock, as state. A human must resolve it (Ledger.resolveEscalations) before any money moves.
    if (ledger.openEscalationsFor(p.orderId).length) return { status: 'rejected', reason: 'OPEN_ESCALATION', entry: ledger.markRejected(proposalId, 'OPEN_ESCALATION') };

    // 4. Approval binding. A mismatch does not reject the proposal itself: a human may re-approve on current facts.
    if (!approval.stateVersion || approval.stateVersion !== p.stateVersion) return { status: 'rejected', reason: 'STALE_APPROVAL', entry: { ...p } };
    if (stateVersion(world, claim, ledger) !== p.stateVersion) return { status: 'rejected', reason: 'FACTS_CHANGED_SINCE_APPROVAL', entry: { ...p } };

    // 5. Independent recheck against fresh source data and the current ledger.
    const d = policyFor(world, claim, ledger);
    const why =
      d.outcome !== 'REFUND_ELIGIBLE' ? `POLICY_NOW_${d.outcome}:${d.reasonCode}`
      : d.amountUsd !== p.amountUsd ? `AMOUNT_MISMATCH:${p.amountUsd}!=${d.amountUsd}`
      : d.policyVersion !== p.policyVersion ? 'POLICY_VERSION_CHANGED'
      : null;
    if (why) return { status: 'rejected', reason: why, entry: ledger.markRejected(proposalId, why) };
    return { status: 'committed', entry: ledger.markCommitted(proposalId, by) };
  });
}
