/** Compact eval numbers for the Evals view, read from the committed result files (no model calls). */
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const load = (f: string) => { const p = path.join(process.cwd(), 'evals/results', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const pick = (s: any) => s && ({
  cases: s.cases, runs: s.runs, criticals: s.criticalViolations, runsWithCritical: s.runsWithCritical,
  outcome: [s.outcomeCorrect, s.runs], agree: [s.agentAgrees, s.agentAgreeDen], evidence: [s.evidenceOk, s.evidenceDen],
  reliable: [s.reliable, s.runs], injection: [s.injectionCaught, s.injectionDen], benignFP: [s.benignFP, s.benignDen],
  blocked: s.blockedAttempts, p50: s.p50, p95: s.p95, tokens: s.tokensPerRun,
});

export async function GET() {
  const rowsFile = path.join(process.cwd(), 'evals/results/live-rows.jsonl');
  const rows: any[] = fs.existsSync(rowsFile) ? fs.readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const clean = rows.filter((r) => r.reliable).map((r) => r.latencyMs).sort((a, b) => a - b);
  const q = (p: number) => (clean.length ? clean[Math.min(clean.length - 1, Math.ceil(p * clean.length) - 1)] : null);
  const det = load('deterministic.json'), live = load('live.json'), noG = load('deterministic-ablation-no-guards.json');
  return Response.json({
    generatedAt: det?.at ?? null, pack: det?.pack ?? 'v1',
    scripted: pick(det?.summaries?.scripted), adversarial: pick(det?.summaries?.['scripted-adversarial']),
    live: live ? { model: String(live.liveModel ?? '').replace(/^google:/, ''), at: live.at, quotaStoppedAt: live.liveStats?.quotaStoppedAt ?? null, ...pick(live.summaries.live), cleanP50: q(0.5), cleanP95: q(0.95), timeouts: rows.length - clean.length } : null,
    ablationNoGuards: noG ? pick(noG.summaries['scripted-adversarial']) : null,
  });
}
