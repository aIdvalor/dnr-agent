import { DEMO, demoWorldAndClaim } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(DEMO.map((d) => {
    const { world, claim } = demoWorldAndClaim(d.id);
    return { ...d, claim, order: world.orders[claim.orderId] ?? null, scans: world.scans[claim.orderId] ?? [], buyer: world.buyers[claim.buyerId], faults: world.faults ?? null, asOf: world.asOf };
  }));
}
