import { demoLedger } from '@/lib/demo';
import { liveModelAvailable } from '@/lib/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ entries: demoLedger().all(), live: liveModelAvailable().ok });
}
export async function DELETE() {
  demoLedger().reset();
  return Response.json({ ok: true });
}
