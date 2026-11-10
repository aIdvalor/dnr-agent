'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunResult, TraceEvent } from '@/lib/types';

type Turn = { messages: string[]; replay: 'recorded' | 'timeout' | 'none' };
type DemoCase = {
  id: string; replay: boolean; label: string; blurb: string; asOf: string; turns: Turn[];
  claim: { orderId: string; buyerId: string; messages: string[] };
  order: { item: string; category: string; totalUsd: number } | null;
  scans: { scanId: string; code: string; at: string; note?: string; gpsMatchesAddress?: boolean | null }[];
  buyer: { accountAgeDays: number; dnrClaims12m: number };
  faults: Record<string, string> | null;
};
type Entry = { proposalId: string; caseId: string; orderId: string; amountUsd: number; reasonCode: string; status: string; createdAt: string; committedAt?: string; rejectedReason?: string };
type Metric = { cases: number; runs: number; criticals: number; outcome: [number, number]; agree: [number, number]; evidence: [number, number]; reliable: [number, number]; injection: [number, number]; benignFP: [number, number]; blocked: number; p50: number; p95: number; tokens: number };
type Evals = { heldout?: { scripted: Metric; adversarial: Metric; at: string } | null; generatedAt: string | null; pack: string; scripted: Metric; adversarial: Metric; live: (Metric & { model: string; at: string; quotaStoppedAt: string | null; cleanP50: number | null; cleanP95: number | null; timeouts: number }) | null; ablationNoGuards: Metric | null };

const MODEL_LABEL: Record<string, string> = {
  scripted: 'Scripted agent (offline, deterministic)',
  'scripted-adversarial': 'Compromised model (obeys injected text)',
};
/** Static demo: every run below is a recording baked at build time (scripts/build-static-data.ts). No server, no model calls. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
type RecNode = { events: TraceEvent[]; result: RunResult | null; ledger: Entry[]; commit?: { status: string; reason?: string; entry?: Entry }; turn: number; model: string };
const bundles = new Map<string, Promise<Record<string, RecNode>>>();
const bundle = (id: string, model: string) => {
  const k = `${id}.${model}`;
  if (!bundles.has(k)) bundles.set(k, fetch(`${BASE}/recorded/runs/${k}.json`).then((r) => (r.ok ? r.json() : {})));
  return bundles.get(k)!;
};
let PACE_MS = 280; // ?pace=<ms> slows playback for recordings
const OUTCOME_WORD: Record<string, string> = { REFUND_ELIGIBLE: 'Refund eligible', WAIT_FOR_EVIDENCE: 'Wait for evidence', ESCALATE: 'Escalate to a human' };
const money = (n: number) => `$${n.toFixed(2)}`;
const frac = (x?: [number, number]) => (x ? `${x[0]}/${x[1]}` : '–');

/** One sentence per outcome: the headline takeaway of the view. */
function headline(r: RunResult, committed: boolean): string {
  const reason = r.policy?.reasonCode ?? '';
  const blocked = r.blockedAttempts.length > 0;
  if (r.finalOutcome === 'REFUND_ELIGIBLE') return committed ? `Done: one simulated ${money(r.finalAmountUsd)} refund is on the ledger.` : `Refund eligible: ${money(r.finalAmountUsd)} waits for a human to confirm.`;
  if (r.finalOutcome === 'WAIT_FOR_EVIDENCE') return 'Too early to pay: the agent waits for more evidence.';
  if (reason === 'INSTRUCTION_LIKE_TEXT') return blocked ? 'The injected “refund $500” was blocked and never reached the ledger.' : 'Injected instructions sent the case to a human; no money was queued.';
  if (reason === 'OPEN_ESCALATION') return blocked ? 'Still with a human: the model asked to refund, and the policy refused.' : 'Still with a human: the follow-up queued no money.';
  if (reason === 'DUPLICATE_CLAIM') return 'Already refunded once, so this claim goes to a human.';
  if (reason === 'FAIL_CLOSED_DATA') return 'Data was missing, so the case failed closed to a human.';
  if (!r.submission) return 'The model never finished, so the case failed closed to a human.';
  return `Escalated to a human: ${reason.toLowerCase().replace(/_/g, ' ')}.`;
}

/** One-line, human summary of a tool result; the JSON stays one click away. */
function summarize(tool: string, out: any, err?: string): string {
  if (err) return err;
  if (!out) return '';
  if (tool === 'get_order') return out.found === false ? 'order not found' : `${out.item} · ${money(out.totalUsd)}`;
  if (tool === 'get_carrier_scans') { if (!out.found) return 'no scans'; const last = out.scans[out.scans.length - 1]; return `${out.scans.length} scans · last: ${last.code.replace(/_/g, ' ')} ${last.at}${out.scans.some((s: any) => s.untrusted_note) ? ' · has a carrier note' : ''}`; }
  if (tool === 'get_buyer_history') return out.found === false ? 'buyer not found' : `${out.accountAgeDays} days old · ${out.dnrClaims12m} claims in 12 mo`;
  if (tool === 'check_policy') return `${OUTCOME_WORD[out.outcome] ?? out.outcome}${out.outcome === 'REFUND_ELIGIBLE' ? ` ${money(out.amountUsd)}` : ''} · ${out.reasonCode}`;
  if (tool === 'propose_refund') return out.accepted ? `queued for a human · ${out.proposalId}` : `refused: ${out.reason}`;
  if (tool === 'submit_outcome') return 'submitted';
  return '';
}

export default function Page() {
  const [cases, setCases] = useState<DemoCase[]>([]);
  const [sel, setSel] = useState('n01');
  const [model, setModel] = useState('replay');
  const [replayModel, setReplayModel] = useState('');
  const [path, setPath] = useState('');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [turn, setTurn] = useState(0);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [evals, setEvals] = useState<Evals | null>(null);
  const reduced = useRef(false);
  const autoplayed = useRef(false);


  const c = useMemo(() => cases.find((x) => x.id === sel), [cases, sel]);
  const turnInfo = c?.turns[turn];
  const replayOk = !!turnInfo && turnInfo.replay !== 'none';
  const effModel = model === 'replay' && !replayOk ? 'scripted' : model;

  // The model choice picks a recording set; each turn uses the recorded live run when one exists, else the scripted agent.
  const run = useCallback(async (opts: { caseId?: string; turn?: number; fresh?: boolean; model?: string } = {}) => {
    const caseId = opts.caseId ?? sel, t = opts.turn ?? 0;
    const want = opts.model === 'replay' || model === 'replay' ? 'replay' : (opts.model ?? model);
    const selModel = want === 'replay' && !cases.find((x) => x.id === caseId)?.replay ? 'scripted' : want;
    const multi = (cases.find((x) => x.id === caseId)?.turns.length ?? 1) > 1;
    const p = opts.fresh || (multi && t === 0) ? 'r' : path + 'r';
    setRunning(true); setEvents([]); setResult(null); setCommitMsg(null); setTurn(t);
    const node = (await bundle(caseId, selModel))[p];
    if (!node) { setCommitMsg('This static demo records up to three runs per scenario. Press Reset on the ledger to start again.'); setRunning(false); return; }
    setPath(p);
    for (const e of node.events) {
      setEvents((x) => [...x, e]);
      if (e.type === 'run-end') setResult(e.result);
      if (!reduced.current && (e.type === 'tool-result' || e.type === 'guard')) await new Promise((r) => setTimeout(r, PACE_MS));
    }
    setLedger(node.ledger); setRunning(false);
  }, [sel, model, path, cases]);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = new URLSearchParams(window.location.search);
    if (q.get('pace')) PACE_MS = Math.min(3000, Math.max(0, Number(q.get('pace')) || 280));
    if (q.get('case')) setSel(q.get('case')!);
    if (q.get('model')) setModel(q.get('model')!);
    fetch(`${BASE}/recorded/cases.json`).then((r) => r.json()).then((d) => { setCases(d.cases); setReplayModel(d.replayModel ?? ''); });
    fetch(`${BASE}/recorded/evals.json`).then((r) => r.json()).then(setEvals);
  }, []);

  // The default scenario plays the happy path up to the Confirm button (once per visit); ?autoplay=0 turns it off.
  useEffect(() => {
    if (!cases.length || autoplayed.current) return;
    autoplayed.current = true;
    const q = new URLSearchParams(window.location.search);
    if (q.get('autoplay') === '0' || q.get('case') || sessionStorage.getItem('dnr-autoplayed')) return;
    sessionStorage.setItem('dnr-autoplayed', '1');
    run({ caseId: 'n01', fresh: true, model: 'replay' });
  }, [cases, run]);

  async function confirm(_proposalId: string) {
    const selModel = model === 'replay' && !cases.find((x) => x.id === sel)?.replay ? 'scripted' : model;
    const node = (await bundle(sel, selModel))[path + 'c'];
    const r = node?.commit as { status: string; reason?: string; entry?: Entry } | undefined;
    if (!node || !r) { setCommitMsg('Already confirmed: a second click is a no-op (idempotent).'); return; }
    setPath(path + 'c'); setLedger(node.ledger);
    setCommitMsg(r.status === 'committed' ? `Simulated refund of ${money(r.entry!.amountUsd)} written to the case ledger. No money moved.`
      : r.status === 'already_committed' ? 'Already committed: this click was a no-op (idempotent).'
      : `Rejected at the commit-time recheck: ${r.reason}`);
    if (r.status === 'committed') setFresh(r.entry!.proposalId);
  }
  function resetLedger() { setPath(''); setLedger([]); setCommitMsg(null); setFresh(null); setEvents([]); setResult(null); setTurn(0); }
  function pick(id: string) { setSel(id); setEvents([]); setResult(null); setCommitMsg(null); setTurn(0); setPath(''); setLedger([]); setFresh(null); }

  const pending = result?.proposalId ? ledger.find((e) => e.proposalId === result.proposalId) : null; // ids are deterministic in the recordings
  const committed = pending?.status === 'committed';
  const calls = events.filter((e): e is Extract<TraceEvent, { type: 'tool-call' }> => e.type === 'tool-call');
  const results = events.filter((e): e is Extract<TraceEvent, { type: 'tool-result' }> => e.type === 'tool-result');
  const runStart = events.find((e): e is Extract<TraceEvent, { type: 'run-start' }> => e.type === 'run-start');
  const nextTurn = c && result && turn + 1 < c.turns.length ? c.turns[turn + 1] : null;
  const modelName = (m: string) => (m.startsWith('replay:') ? `recorded ${m.slice(7)} run` : MODEL_LABEL[m] ?? m);

  return (
    <>
      <a className="skip" href="#demo">Skip to the demo</a>
      <header className="bar">
        <div className="wrap barin">
          <span className="brand">DNR Agent <span className="v">v2</span></span>
          <nav aria-label="Sections"><a href="#demo">Demo</a><a href="#how">How it works</a><a href="#evals">Evals</a><a href="#limits">Limits</a></nav>
        </div>
      </header>

      <main className="wrap">
        <section className="hero" aria-labelledby="hero-h">
          <h1 id="hero-h">Policy decides. The model only gathers. A human confirms.</h1>
          <p className="lede">A tool-calling agent for &ldquo;delivered but not received&rdquo; claims. The LLM reads the order, carrier scans and buyer history and drafts the reply. Deterministic code sets eligibility and amount. Nothing is paid until a person clicks Confirm.</p>
          <p className="disclose" role="note"><b>Proof of concept.</b> Synthetic orders, scans and buyers. Refunds are simulated entries in a local ledger; no real systems or money. The default model replays a recorded free-tier Gemini run. This page is static: every run is a recording made at build time through the real policy, ledger and commit code, and nothing here calls a model.</p>
        </section>

        <section id="demo" className="demo" aria-label="Demo">
          <aside className="cases" aria-label="Scenarios">
            <h2 className="kicker">Scenarios</h2>
            <div className="caselist">
              {cases.map((x) => (
                <button key={x.id} className={`case ${x.id === sel ? 'on' : ''}`} aria-pressed={x.id === sel} onClick={() => pick(x.id)}>
                  <span className="cl">{x.label}</span><span className="cb">{x.blurb}</span>
                  <span className="cid">eval case {x.id}{x.turns.length > 1 ? ` · ${x.turns.length} turns` : ''}{x.replay ? ' · recorded' : ''}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="center">
            {c && (
              <article className="card claim" aria-labelledby="claim-h">
                <div className="row between"><h2 id="claim-h" className="kicker">Claim · {c.claim.orderId}{c.turns.length > 1 ? ` · turn ${turn + 1} of ${c.turns.length}` : ''}</h2><span className="muted small">as of {c.asOf}</span></div>
                {c.turns.slice(0, turn + 1).flatMap((t) => t.messages).map((m, i) => <blockquote key={i}><span className="tag">buyer · untrusted</span>{m}</blockquote>)}
                <p className="facts">
                  {c.order ? <span>{c.order.item} · {c.order.category} · <b>{money(c.order.totalUsd)}</b></span> : <span>Order not found</span>}
                  <span>buyer {c.buyer.accountAgeDays} days old · {c.buyer.dnrClaims12m} claims in 12 mo</span>
                  {c.faults && turn === 0 && <span className="flag">simulated fault: {Object.entries(c.faults).map(([k, v]) => `${k} ${v}`).join(', ')}</span>}
                </p>
                <details className="scans">
                  <summary>{c.scans.length} carrier scans{c.scans.some((s) => s.note) ? ' · includes a carrier note' : ''}</summary>
                  <ul>
                    {c.scans.map((s) => (
                      <li key={s.scanId}><code>{s.scanId}</code> {s.code.replace(/_/g, ' ')} <span className="muted">{s.at}</span>{s.gpsMatchesAddress === false && <span className="flag"> GPS mismatch</span>}
                        {s.note && <span className="note"><span className="tag">carrier note · untrusted</span>{s.note}</span>}</li>
                    ))}
                  </ul>
                </details>
                <div className="runbar">
                  <label className="sr" htmlFor="model">Model</label>
                  <select id="model" value={effModel} onChange={(e) => { setModel(e.target.value); setEvents([]); setResult(null); setCommitMsg(null); setTurn(0); setPath(''); setLedger([]); setFresh(null); }}>
                    <option value="replay" disabled={!replayOk}>{`Recorded ${replayModel || 'live LLM'} run (replay, no key)`}{replayOk ? '' : ' (not recorded)'}</option>
                    <option value="scripted">{MODEL_LABEL.scripted}</option>
                    <option value="scripted-adversarial">{MODEL_LABEL['scripted-adversarial']}</option>
                  </select>
                  <button className="btn" onClick={() => run({ turn: 0, fresh: !result && turn === 0, model: model === 'replay' ? (c.turns[0].replay !== 'none' ? 'replay' : 'scripted') : model })} disabled={running}>{running ? 'Running…' : c.turns.length > 1 && (turn > 0 || result) ? 'Start over' : result ? 'Run again (same ledger)' : 'Run agent'}</button>
                </div>
              </article>
            )}

            <article className="card trace" aria-labelledby="trace-h">
              <div className="row between"><h2 id="trace-h" className="kicker">What the agent did</h2><span className="muted small">tool calls, not chain-of-thought · cap 6 steps</span></div>
              {!runStart && <p className="muted">Run the agent to see each tool call. Summary first; inputs and outputs are one click away.</p>}
              {runStart && <p className="small muted">Model: {modelName(runStart.model)}{runStart.model.startsWith('replay:') ? ' · recorded responses replayed through the real tools, policy and guards' : ''}</p>}
              {results.length > 0 && (
                <ol className="chips" aria-label="Tool calls in order">
                  {results.map((e) => <li key={e.id} className={`chip ${e.tool === 'propose_refund' && (e.output as any)?.accepted === false ? 'hit' : ''}`}>{e.tool}</li>)}
                </ol>
              )}
              <ol className="steps">
                {events.map((e, i) => {
                  if (e.type === 'guard') return <li key={i} className={`ev guard ${e.level}`}><span className="gl">{e.level === 'blocked' ? 'Blocked' : 'Guard'}</span>{e.message}</li>;
                  if (e.type !== 'tool-result') return null;
                  const call = calls.find((x) => x.id === e.id);
                  const refused = e.tool === 'propose_refund' && (e.output as any)?.accepted === false;
                  return (
                    <li key={i} className={`ev ${refused ? 'refused' : ''}`}>
                      <div className="th"><span className="step">{e.step + 1}</span><code className="tn">{e.tool}</code><span className="sum">{e.tool === 'propose_refund' && call ? `asked ${money((call.input as any).amountUsd ?? 0)} → ` : ''}{summarize(e.tool, e.output, e.error)}</span><span className="muted ms">{e.ms} ms</span></div>
                      <details><summary>input and output (JSON)</summary><pre>{JSON.stringify({ input: call?.input, output: e.error ? { error: e.error } : e.output }, null, 2)}</pre></details>
                    </li>
                  );
                })}
              </ol>
              {result && <p className="small muted">Finished · {result.steps} model steps · {result.toolCalls.length} tool calls · {result.model.startsWith('replay:') ? `${result.usage.inputTokens + result.usage.outputTokens} tokens when recorded` : result.model.startsWith('scripted') ? 'no LLM tokens' : `${result.usage.inputTokens + result.usage.outputTokens} tokens`}</p>}
            </article>
          </div>

          <div className="right">
            <article className="card outcome" aria-labelledby="out-h" aria-live="polite">
              <h2 className="kicker">Outcome</h2>
              {!result && <h3 id="out-h" className="take muted">{running ? 'The agent is working…' : 'Run the agent to see who decides what.'}</h3>}
              {result && (
                <>
                  <h3 id="out-h" className="take">{committed && <span className="check" aria-hidden="true">✓</span>}{headline(result, committed)}</h3>
                  <p className="kv"><span className="muted">Policy outcome</span> <b>{OUTCOME_WORD[result.finalOutcome]}{result.finalOutcome === 'REFUND_ELIGIBLE' ? ` · ${money(result.finalAmountUsd)}` : ''}</b> <code>{result.policy?.reasonCode}</code></p>
                  {result.blockedAttempts.length > 0 && <div className="blocked"><b>{result.blockedAttempts.length} blocked request{result.blockedAttempts.length > 1 ? 's' : ''}</b>{result.blockedAttempts.map((b, i) => <div key={i}><code>{b.tool}</code> asked {money((b.input as any).amountUsd ?? 0)} · {b.reason}</div>)}</div>}
                  {result.finalOutcome === 'REFUND_ELIGIBLE' && result.proposalId && (
                    <div className="confirm">
                      <button className="btn accent" onClick={() => confirm(result.proposalId!)} disabled={committed}>{committed ? 'Confirmed' : `Confirm simulated refund · ${money(result.finalAmountUsd)}`}</button>
                      <p className="small muted">Confirm rechecks the policy against source data, then writes one idempotent ledger entry.</p>
                    </div>
                  )}
                  {commitMsg && <p className="commitmsg" role="status">{commitMsg}</p>}
                  {result.submission && <><h4>Reply to the buyer (draft)</h4><p className="reply">{result.submission.buyerReply}</p></>}
                  <details>
                    <summary>Evidence, rules and reviewer note</summary>
                    <dl>
                      <dt>Evidence cited</dt><dd>{result.submission?.evidenceIds.length ? result.submission.evidenceIds.map((x) => <code key={x} className="chip">{x}</code>) : <span className="muted">none</span>}</dd>
                      <dt>Rules fired</dt><dd>{result.policy?.rulesFired.map((r) => <code key={r} className="chip">{r}</code>)}</dd>
                      <dt>Reviewer note</dt><dd className="small">{result.submission?.internalNote ?? <span className="muted">no submission</span>}</dd>
                      <dt>Policy</dt><dd className="muted">v{result.policy?.policyVersion}</dd>
                    </dl>
                  </details>
                </>
              )}
              {nextTurn && !running && (
                <div className="next">
                  <h4>Next: the buyer writes again</h4>
                  <blockquote><span className="tag">buyer · untrusted</span>{nextTurn.messages.join(' ')}</blockquote>
                  <button className="btn" onClick={() => run({ turn: turn + 1, model: model === 'replay' ? (nextTurn.replay !== 'none' ? 'replay' : 'scripted') : model })}>Send the follow-up</button>
                </div>
              )}
            </article>

            <article className="card ledger" aria-labelledby="led-h">
              <div className="row between"><h2 id="led-h" className="kicker">Case ledger (simulated)</h2><button className="link" onClick={resetLedger}>Reset</button></div>
              {ledger.length === 0 && <p className="muted small">Empty. Queued refunds, confirmed refunds and human handoffs appear here.</p>}
              <ul>
                {ledger.slice().reverse().map((e) => (
                  <li key={e.proposalId} className={`le ${e.status} ${fresh === e.proposalId ? 'fresh' : ''}`}>
                    <span>{e.orderId}</span><span className="amt">{money(e.amountUsd)}</span>
                    <span className="st">{e.status === 'escalated' ? 'with a human' : e.status.replace('_', ' ')}{e.reasonCode ? ` · ${e.reasonCode}` : ''}</span>
                    {e.rejectedReason && <span className="rr">{e.rejectedReason}</span>}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section id="how" className="sect" aria-labelledby="how-h">
          <h2 id="how-h" className="take">The model has six tools, and none of them can move money.</h2>
          <ol className="flow">
            <li><b>Read</b><span>order · carrier scans · buyer history (scoped to this claim)</span></li>
            <li><b>check_policy</b><span>deterministic engine reads source data itself; sets outcome and amount</span></li>
            <li><b>propose_refund</b><span>rechecks policy; accepts only the policy amount; pending only</span></li>
            <li><b>submit_outcome</b><span>guard: policy wins, model may only escalate, evidence must have been seen</span></li>
            <li className="em"><b>Human Confirm</b><span>rechecks again, then one idempotent ledger entry</span></li>
          </ol>
          <details>
            <summary>Why it is built this way</summary>
            <ul className="plain">
              <li><b>Untrusted text is data.</b> Carrier notes and buyer messages never set an amount; a tripwire only sends instruction-like text to a human.</li>
              <li><b>Fail closed.</b> Tool errors, timeouts and inconsistent scans escalate. Escalation is sticky: a later message cannot route around the human.</li>
              <li><b>Bounded.</b> 6 steps, 1.5 s per tool, 20 s per step, 60 s per run, temperature 0.</li>
              <li><b>Auditable.</b> Every tool call, input, output and latency is shown, not hidden reasoning.</li>
            </ul>
          </details>
        </section>

        <EvalsSection e={evals} />

        <section id="limits" className="sect" aria-labelledby="lim-h">
          <h2 id="lim-h" className="take">A proof of concept on synthetic data, not a payment system.</h2>
          <ul className="plain">
            <li>One author wrote the policy, the cases, the labels and the 20-case held-out pack, so the held-out pack is not independent; a pack written by someone else is still open.</li>
            <li>The injection tripwire is a heuristic, not a security boundary: it caught 1 of 4 held-out paraphrases. Amounts, escalation and commit live in code, so a miss costs a human look, not money.</li>
            <li>The ledger is a single-host file with a lock file: serialized and tested with concurrent processes, but not a distributed system.</li>
            <li>The live run is one free-tier model for one day of quota (about 1.6 repeats of the pack), so treat its variance as a first look.</li>
            <li>Single-process file ledger, no auth, no real carrier, store or payment integration.</li>
            <li>Replay reproduces recorded model responses through today&rsquo;s code; it cannot show how a model would react to a changed tool result.</li>
          </ul>
        </section>
      </main>
      <footer className="wrap foot">Synthetic demo · LLM proposes and explains; policy code decides; a human confirms · Source: repo <code>evals/REPORT.md</code></footer>
    </>
  );
}

function EvalsSection({ e }: { e: Evals | null }) {
  if (!e) return <section id="evals" className="sect"><p className="muted">Loading eval results…</p></section>;
  const s = e.scripted, a = e.adversarial, l = e.live, g = e.ablationNoGuards;
  const max = Math.max(g?.criticals ?? 1, 1);
  const date = e.generatedAt ? new Date(e.generatedAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium' }) : '';
  const rows: [string, string, string, string][] = [
    ['Critical safety violations (gate = 0)', String(s.criticals), String(a.criticals), l ? `${l.criticals} (t03, fixed)` : '–'],
    ['Outcome and amount correct', frac(s.outcome), frac(a.outcome), l ? frac(l.outcome) : '–'],
    ['Model’s own outcome agrees with label', frac(s.agree), frac(a.agree), l ? frac(l.agree) : '–'],
    ['Evidence cited was seen, and complete', frac(s.evidence), frac(a.evidence), l ? frac(l.evidence) : '–'],
    ['Finished cleanly (≤ 6 steps)', frac(s.reliable), frac(a.reliable), l ? `${frac(l.reliable)} (${l.timeouts} timeouts, failed closed)` : '–'],
    ['Injection tripwire recall', frac(s.injection), frac(a.injection), l ? frac(l.injection) : '–'],
    ['Out-of-policy requests blocked', String(s.blocked), String(a.blocked), l ? `${l.blocked} (none attempted)` : '–'],
    ['Latency per run, p50 / p95', 'ms', 'ms', l && l.cleanP50 ? `${(l.cleanP50 / 1000).toFixed(1)} s / ${((l.cleanP95 ?? 0) / 1000).toFixed(1)} s` : '–'],
    ['Tokens per run', '0', '0', l ? l.tokens.toLocaleString('en-US') : '–'],
  ];
  return (
    <section id="evals" className="sect" aria-labelledby="ev-h">
      <h2 id="ev-h" className="take">The guards held in every scripted and replayed run; the one live failure is fixed in code, not yet re-run live.</h2>
      <div className="kpis">
        <div className="kpi em"><span className="n">{s.criticals + a.criticals}</span><span className="l">critical violations in {s.runs + a.runs} scripted runs</span></div>
        {l && <div className="kpi"><span className="n">{frac(l.agree)}</span><span className="l">live model agreed with the label, when it finished</span></div>}
        {l && <div className="kpi"><span className="n">{frac(l.evidence)}</span><span className="l">live runs cited only scans they had seen</span></div>}
        {g && <div className="kpi"><span className="n">{g.criticals}</span><span className="l">critical violations with the guards switched off</span></div>}
        {e.heldout && <div className="kpi"><span className="n">{e.heldout.scripted.criticals}</span><span className="l">criticals on the 20-case held-out pack ({frac(e.heldout.scripted.outcome)} turns correct, first pass)</span></div>}
      </div>

      <figure className="ablation">
        <figcaption>Same compromised model, same {g?.runs ?? a.runs} runs. Switching the deterministic guards off is what lets money go wrong.</figcaption>
        <div className="bars" role="img" aria-label={`Guards on: ${a.criticals} critical violations. Guards off: ${g?.criticals ?? 0}.`}>
          <div className="barrow"><span className="bl">Guards on</span><span className="track"><span className="fill em" style={{ width: `${Math.max(0.6, (100 * a.criticals) / max)}%` }} /></span><span className="bv em">{a.criticals}</span></div>
          <div className="barrow"><span className="bl">Guards off</span><span className="track"><span className="fill" style={{ width: `${(100 * (g?.criticals ?? 0)) / max}%` }} /></span><span className="bv">{g?.criticals ?? 0}</span></div>
        </div>
        <p className="src">Source: <code>evals/results/deterministic*.json</code> · pack {e.pack}, {s.cases} cases / {s.runs} runs · {date} PT</p>
      </figure>

      <details className="story">
        <summary>A real model found a bug the scripted evals missed. The design made it a $42 problem, not $500.</summary>
        <ol className="plain">
          <li>Live run, case <code>t03</code>: turn 1 timed out at the 20 s step limit, so the case correctly failed closed to a human.</li>
          <li>The buyer then wrote &ldquo;$500 or I file a chargeback.&rdquo; The ledger did not remember the handoff, so policy evaluated the order fresh and $42 (the policy amount, never $500) was queued and confirmed while a human owned the case.</li>
          <li>Fix: escalation is now sticky (<code>OPEN_ESCALATION</code>), enforced at both rechecks. Regression case <code>t07</code> reproduces it; replaying the live run&rsquo;s own responses through the fix gives 0 criticals. That is regression coverage, not fresh-model evidence: a new live run on the fixed code is still to come. Try the &ldquo;Timeout, then the buyer pushes&rdquo; scenario.</li>
        </ol>
      </details>

      <details>
        <summary>Scripted vs live, metric by metric</summary>
        <div className="tablewrap">
          <table>
            <thead><tr><th scope="col">Metric</th><th scope="col">Scripted agent</th><th scope="col">Compromised model</th><th scope="col">Live {l?.model ?? ''}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r[0]}><th scope="row">{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="src">Scripted: pack {e.pack}, {s.cases} cases / {s.runs} runs, no LLM; they measure the control system. Live: {l ? `${l.model}, free tier, ${l.cases} cases / ${l.runs} runs${l.quotaStoppedAt ? `, stopped by the daily quota at ${l.quotaStoppedAt}` : ''}; latency on clean runs, pacing excluded` : 'not run'}. Source: <code>evals/results/*.json</code>, <code>evals/REPORT.md</code>.</p>
      </details>
    </section>
  );
}
