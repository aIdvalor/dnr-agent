/**
 * LOCAL live entry point. Not part of the web build (the site is a static export with no API routes).
 * Runs one demo scenario through a real model with your own key, prints the trace, and leaves a simulated ledger
 * at data/ledger.json. Free tier: DNR_MODEL=google:gemini-3.1-flash-lite + GOOGLE_GENERATIVE_AI_API_KEY in .env.local.
 *
 *   npx tsx --env-file=.env.local scripts/live.ts n01            # run turn 0
 *   npx tsx --env-file=.env.local scripts/live.ts t03 --turn 1   # a later turn on the same ledger
 *   npx tsx --env-file=.env.local scripts/live.ts n01 --confirm  # also play the human Confirm
 * Never prints the key or request headers.
 */
import { runAgent } from '../lib/agent';
import { commitRefund } from '../lib/commit';
import { demoLedger, demoWorldAndClaim } from '../lib/demo';
import { liveModelAvailable } from '../lib/models';

const [id = 'n01', ...rest] = process.argv.slice(2);
const turn = rest.includes('--turn') ? Number(rest[rest.indexOf('--turn') + 1]) : 0;
const a = liveModelAvailable();
if (!a.ok) { console.error(`Live model not configured: ${a.why}`); process.exit(2); }
if (!process.env.DNR_LIVE_MIN_INTERVAL_MS && (process.env.DNR_MODEL ?? '').startsWith('google:')) process.env.DNR_LIVE_MIN_INTERVAL_MS = '6500';
const { world, claim } = demoWorldAndClaim(`${id}#${turn}`);
const ledger = demoLedger();
if (turn === 0) ledger.clearOrder(claim.orderId);
const r = await runAgent({
  world, claim, ledger, modelSpec: 'live',
  emit: (e) => {
    if (e.type === 'tool-call') console.log(`→ ${e.tool} ${JSON.stringify(e.input)}`);
    if (e.type === 'tool-result') console.log(`  ← ${e.error ?? JSON.stringify(e.output).slice(0, 200)} (${e.ms} ms)`);
    if (e.type === 'guard') console.log(`  [guard] ${e.message}`);
  },
});
console.log(`\n${r.finalOutcome} $${r.finalAmountUsd} (${r.policy?.reasonCode}) · ${r.steps} steps · ${r.usage.inputTokens + r.usage.outputTokens} tokens`);
if (r.submission) console.log(`reply: ${r.submission.buyerReply}`);
if (rest.includes('--confirm') && r.approval) console.log('confirm:', JSON.stringify(commitRefund({ approval: r.approval, world, claim, ledger, by: 'human:local' })));
