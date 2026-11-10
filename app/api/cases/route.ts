import { DEMO, demoWorldAndClaim } from '@/lib/demo';
import { replayAvailable } from '@/lib/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(DEMO.map((d) => {
    const { world, claim, c } = demoWorldAndClaim(d.id);
    const turns = Array.from({ length: d.turns ?? 1 }, (_, i) => {
      const key = d.turns ? `${d.id}#${i}` : d.id;
      return { messages: c.turns[i].messages, replay: replayAvailable(key) ? 'recorded' : d.recordedTimeoutTurns?.includes(i) ? 'timeout' : 'none' };
    });
    return { ...d, replay: turns[0].replay !== 'none', turns, claim, order: world.orders[claim.orderId] ?? null, scans: world.scans[claim.orderId] ?? [], buyer: world.buyers[claim.buyerId], faults: world.faults ?? null, asOf: world.asOf };
  }));
}
