import { runAgent } from '@/lib/agent';
import { demoLedger, demoWorldAndClaim } from '@/lib/demo';
import { liveModelAvailable } from '@/lib/models';
import type { TraceEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['scripted', 'scripted-adversarial', 'live']);
const PACE = Number(process.env.DNR_DEMO_PACE_MS ?? 280);

export async function POST(req: Request) {
  const { caseId, model } = (await req.json()) as { caseId: string; model: string };
  if (!ALLOWED.has(model)) return Response.json({ error: 'unknown model' }, { status: 400 });
  if (model === 'live' && !liveModelAvailable().ok) return Response.json({ error: `Live model not configured: ${liveModelAvailable().why}` }, { status: 400 });
  let wc;
  try { wc = demoWorldAndClaim(caseId); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 404 }); }
  const { world, claim } = wc;
  const enc = new TextEncoder();
  const paced = model !== 'live'; // scripted runs finish in ms; pace them so the trace is readable
  const stream = new ReadableStream({
    async start(ctrl) {
      const q: TraceEvent[] = []; let done = false; let wake: (() => void) | null = null;
      const push = (e: TraceEvent) => { q.push(e); wake?.(); };
      runAgent({ world, claim, ledger: demoLedger(), modelSpec: model, emit: push }).catch((e) => push({ type: 'guard', level: 'blocked', message: `Run failed: ${(e as Error).message}`, at: Date.now() })).finally(() => { done = true; wake?.(); });
      while (!done || q.length) {
        if (!q.length) { await new Promise<void>((r) => (wake = r)); wake = null; continue; }
        const e = q.shift()!;
        ctrl.enqueue(enc.encode(JSON.stringify(e) + '\n'));
        if (paced && (e.type === 'tool-result' || e.type === 'guard')) await new Promise((r) => setTimeout(r, PACE));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
}
