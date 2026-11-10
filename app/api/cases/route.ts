import { DEMO, demoWorldAndClaim } from '@/lib/demo';
import { replayAvailable } from '@/lib/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(DEMO.map((d) => {
    const { world, claim } = demoWorldAndClaim(d.id);
    return { ...d, replay: replayAvailable(d.id), claim, order: world.orders[claim.orderId] ?? null, scans: world.scans[claim.orderId] ?? [], buyer: world.buyers[claim.buyerId], faults: world.faults ?? null, asOf: world.asOf };
  }));
}
