/**
 * Bakes the public demo into static JSON (public/recorded/). Runs at build time on the builder's machine,
 * with the replay and scripted models only: it cannot reach a live model (getModel is never asked for one),
 * and the browser bundle that reads these files has no model code, no API route and no key.
 *
 * For every scenario and every model choice it records each reachable click path through the real agent loop,
 * tools, policy engine, ledger and commit code: 'r' = run (next turn / run again), 'c' = human Confirm.
 */
import fs from 'node:fs';
import path from 'node:path';
process.env.DNR_DETERMINISTIC_IDS = '1';
process.env.DNR_TOOL_TIMEOUT_MS ??= '300';
const { runAgent } = await import('../lib/agent');
const { Ledger, resetIds } = await import('../lib/ledger');
const { commitRefund } = await import('../lib/commit');
const { DEMO, demoWorldAndClaim, scenario } = await import('../lib/demo');
const { replayAvailable, replayModelName } = await import('../lib/models');
import type { RunResult, TraceEvent } from '../lib/types';

const OUT = 'public/recorded'; // not /demo: that path keeps serving the v1 demo on Pages
const MODELS = ['replay', 'scripted', 'scripted-adversarial'] as const;
const TIMEOUT_NOTE = 'Recorded live run: the model call hit the 20 s step limit here, so there is no response to replay. Replaying that faithfully: no outcome is submitted.';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/runs`, { recursive: true });

const turnReplay = (id: string, i: number) => {
  const d = scenario(id)!; const key = d.turns ? `${id}#${i}` : id;
  return replayAvailable(key) ? 'recorded' : d.recordedTimeoutTurns?.includes(i) ? 'timeout' : 'none';
};

// cases.json (what /api/cases used to serve)
const cases = DEMO.map((d) => {
  const { world, claim, c } = demoWorldAndClaim(d.id);
  const turns = Array.from({ length: d.turns ?? 1 }, (_, i) => ({ messages: c.turns[i].messages, replay: turnReplay(d.id, i) }));
  return { ...d, replay: turns[0].replay !== 'none', turns, claim, order: world.orders[claim.orderId] ?? null, scans: world.scans[claim.orderId] ?? [], buyer: world.buyers[claim.buyerId], faults: world.faults ?? null, asOf: world.asOf };
});
fs.writeFileSync(`${OUT}/cases.json`, JSON.stringify({ replayModel: replayModelName(), cases }));

interface Node { events: TraceEvent[]; result: RunResult | null; ledger: unknown[]; commit?: unknown; turn: number; model: string }

async function simulate(id: string, sel: string, pathStr: string): Promise<Node | null> {
  resetIds();
  const d = scenario(id)!; const nTurns = d.turns ?? 1;
  const maxRuns = d.turns ? nTurns : 3;
  const ledger = new Ledger();
  let runs = 0; let last: RunResult | null = null; let node: Node | null = null; let confirmedLast = false;
  for (const a of pathStr) {
    if (a === 'r') {
      if (runs >= maxRuns) return null;
      const turn = d.turns ? runs : 0;
      const m = sel === 'replay' ? (turnReplay(id, turn) !== 'none' ? 'replay' : 'scripted') : sel;
      const { world, claim } = demoWorldAndClaim(`${id}#${turn}`);
      const events: TraceEvent[] = [];
      last = await runAgent({ world, claim, ledger, modelSpec: m, emit: (e) => { events.push(e); if (e.type === 'run-start' && m === 'replay' && turnReplay(id, turn) === 'timeout') events.push({ type: 'guard', level: 'info', message: TIMEOUT_NOTE, at: e.at }); } });
      runs++; confirmedLast = false;
      node = { events, result: last, ledger: ledger.all(), turn, model: m };
    } else {
      if (!last?.approval || confirmedLast || last.finalOutcome !== 'REFUND_ELIGIBLE') return null;
      const turn = node!.turn;
      const { world, claim } = demoWorldAndClaim(`${id}#${turn}`);
      const commit = commitRefund({ approval: last.approval, world, claim, ledger, by: 'human:demo' });
      confirmedLast = true;
      node = { ...node!, ledger: ledger.all(), commit };
    }
  }
  return node;
}

let files = 0, nodes = 0;
for (const d of DEMO) for (const sel of MODELS) {
  if (sel === 'replay' && !cases.find((c) => c.id === d.id)!.replay) continue;
  const out: Record<string, Node> = {};
  const queue = ['r'];
  while (queue.length) {
    const p = queue.shift()!;
    const n = await simulate(d.id, sel, p);
    if (!n) continue;
    out[p] = n; nodes++;
    queue.push(p + 'r', p + 'c');
  }
  fs.writeFileSync(`${OUT}/runs/${d.id}.${sel}.json`, JSON.stringify(out)); files++;
}

// evals.json (what /api/evals used to serve), from the committed result files.
const load = (f: string) => { const p = path.join('evals/results', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const pick = (s: any) => s && ({
  cases: s.cases, runs: s.runs, criticals: s.criticalViolations, runsWithCritical: s.runsWithCritical,
  outcome: [s.outcomeCorrect, s.runs], agree: [s.agentAgrees, s.agentAgreeDen], evidence: [s.evidenceOk, s.evidenceDen],
  reliable: [s.reliable, s.runs], injection: [s.injectionCaught, s.injectionDen], benignFP: [s.benignFP, s.benignDen],
  blocked: s.blockedAttempts, p50: s.p50, p95: s.p95, tokens: s.tokensPerRun,
});
const rowsFile = 'evals/results/live-rows.jsonl';
const rows: any[] = fs.existsSync(rowsFile) ? fs.readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const clean = rows.filter((r) => r.reliable).map((r) => r.latencyMs).sort((a, b) => a - b);
const q = (p: number) => (clean.length ? clean[Math.min(clean.length - 1, Math.ceil(p * clean.length) - 1)] : null);
const det = load('deterministic.json'), live = load('live.json'), noG = load('deterministic-ablation-no-guards.json'), ho = load('deterministic-heldout.json');
fs.writeFileSync(`${OUT}/evals.json`, JSON.stringify({
  generatedAt: det?.at ?? null, pack: det?.pack ?? 'v1',
  scripted: pick(det?.summaries?.scripted), adversarial: pick(det?.summaries?.['scripted-adversarial']),
  live: live ? { model: String(live.liveModel ?? '').replace(/^google:/, ''), at: live.at, quotaStoppedAt: live.liveStats?.quotaStoppedAt ?? null, ...pick(live.summaries.live), cleanP50: q(0.5), cleanP95: q(0.95), timeouts: rows.length - clean.length } : null,
  ablationNoGuards: noG ? pick(noG.summaries['scripted-adversarial']) : null,
  heldout: ho ? { scripted: pick(ho.summaries.scripted), adversarial: pick(ho.summaries['scripted-adversarial']), at: ho.at } : null,
}));
console.log(`static demo data: ${files} run files, ${nodes} recorded click paths, cases.json, evals.json -> ${OUT}/`);
