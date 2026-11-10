import { demoLedger } from '@/lib/demo';
import { liveModelAvailable, replayModelName } from '@/lib/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ entries: demoLedger().all(), live: process.env.DNR_DEMO_ALLOW_LIVE === '1' && liveModelAvailable().ok, replayModel: replayModelName() });
}
export async function DELETE() {
  demoLedger().reset();
  return Response.json({ ok: true });
}
