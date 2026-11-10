import { runAgent } from '@/lib/agent';
import { demoLedger, demoWorldAndClaim, scenario } from '@/lib/demo';
import { liveModelAvailable, replayAvailable } from '@/lib/models';
import type { TraceEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['replay', 'scripted', 'scripted-adversarial', 'live']);
// Live calls spend the owner's key, so the app refuses them unless explicitly enabled (never in a public demo).
const LIVE_ENABLED = process.env.DNR_DEMO_ALLOW_LIVE === '1';
const PACE = Number(process.env.DNR_DEMO_PACE_MS ?? 280);

export async function POST(req: Request) {
  const { caseId, model, turn = 0, fresh = false, pace = true } = (await req.json()) as { caseId: string; model: string; turn?: number; fresh?: boolean; pace?: boolean };
  if (!ALLOWED.has(model)) return Response.json({ error: 'unknown model' }, { status: 400 });
  if (model === 'live' && !LIVE_ENABLED) return Response.json({ error: 'Live model calls are disabled in this demo (set DNR_DEMO_ALLOW_LIVE=1 locally).' }, { status: 403 });
  if (model === 'live' && !liveModelAvailable().ok) return Response.json({ error: `Live model not configured: ${liveModelAvailable().why}` }, { status: 400 });
  let wc;
  try { wc = demoWorldAndClaim(`${caseId.split('#')[0]}#${turn}`); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 404 }); }
  const { world, claim } = wc;
  const sc = scenario(caseId)!;
  const ledger = demoLedger();
  // A multi-turn scenario starts fresh: forget this order's ledger history when its first turn runs.
  if ((sc.turns && wc.turn === 0) || fresh) ledger.clearOrder(claim.orderId);
  if (model === 'replay' && !replayAvailable(claim.caseId) && !sc.recordedTimeoutTurns?.includes(wc.turn)) return Response.json({ error: 'No recorded live run for this scenario: pick the scripted agent.' }, { status: 400 });
  const timeoutNote = model === 'replay' && sc.recordedTimeoutTurns?.includes(wc.turn)
    ? 'Recorded live run: the model call hit the 20 s step limit here, so there is no response to replay. Replaying that faithfully: no outcome is submitted.' : null;
  const enc = new TextEncoder();
  const paced = model !== 'live' && pace !== false; // scripted/replay runs finish in ms; pace them so the trace is readable
  const stream = new ReadableStream({
    async start(ctrl) {
      const q: TraceEvent[] = []; let done = false; let wake: (() => void) | null = null;
      const push = (e: TraceEvent) => {
        q.push(e);
        if (e.type === 'run-start' && timeoutNote) q.push({ type: 'guard', level: 'info', message: timeoutNote, at: Date.now() });
        wake?.();
      };
      runAgent({ world, claim, ledger, modelSpec: model, emit: push }).catch((e) => push({ type: 'guard', level: 'blocked', message: `Run failed: ${(e as Error).message}`, at: Date.now() })).finally(() => { done = true; wake?.(); });
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
