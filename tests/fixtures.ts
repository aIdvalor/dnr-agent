import type { Claim, World } from '../lib/types';
export function w(over: Partial<{ total: number; days: number; note: string; gps: boolean; claims: number; category: any }> = {}): World {
  const d = (n: number) => new Date(Date.parse('2026-11-09') - n * 864e5).toISOString().slice(0, 10);
  return {
    asOf: '2026-11-09',
    orders: { O1: { orderId: 'O1', buyerId: 'B1', item: 'Mug', category: over.category ?? 'general', totalUsd: over.total ?? 42, shippedAt: d(10) } },
    scans: { O1: [
      { scanId: 'S1', code: 'label_created', at: d(10) },
      { scanId: 'S2', code: 'in_transit', at: d(9) },
      { scanId: 'S3', code: 'delivered', at: d(over.days ?? 5), note: over.note, gpsMatchesAddress: over.gps ?? true },
    ] },
    buyers: { B1: { buyerId: 'B1', accountAgeDays: 900, orders12m: 10, dnrClaims12m: over.claims ?? 0, chargebacks12m: 0 } },
  };
}
export const claim = (messages = ['It never came.']): Claim => ({ caseId: 'c1', orderId: 'O1', buyerId: 'B1', messages });

import { Ledger } from '../lib/ledger';
import { stateVersion } from '../lib/data';
import { POLICY } from '../lib/policy';
export const PV = POLICY.version;
/** Queue a proposal the way propose_refund does: bound to the current facts. Returns the approval a human would present. */
export function queue(l: Ledger, world: World, c: Claim, o: Partial<{ amountUsd: number; reasonCode: string; caseId: string }> = {}) {
  const p = l.propose({ caseId: o.caseId ?? c.caseId, orderId: c.orderId, amountUsd: o.amountUsd ?? 42, reasonCode: o.reasonCode ?? 'WAIT_WINDOW_ELAPSED', policyVersion: PV, stateVersion: stateVersion(world, c, l) });
  return { proposalId: p.proposalId, stateVersion: p.stateVersion! };
}
