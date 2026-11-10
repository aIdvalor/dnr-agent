import { commitRefund } from '@/lib/commit';
import { demoLedger, demoWorldAndClaim } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The human Confirm button. Takes only a proposal id: the amount comes from the ledger and is rechecked against policy. */
export async function POST(req: Request) {
  const { proposalId } = (await req.json()) as { proposalId: string };
  const ledger = demoLedger();
  const p = ledger.get(proposalId);
  if (!p) return Response.json({ status: 'rejected', reason: 'UNKNOWN_PROPOSAL' }, { status: 404 });
  const { world, claim } = demoWorldAndClaim(p.caseId);
  return Response.json(commitRefund({ proposalId, world, claim, ledger, by: 'human:demo' }));
}
