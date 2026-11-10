'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunResult, TraceEvent } from '@/lib/types';

type DemoCase = {
  id: string; replay: boolean; label: string; blurb: string; asOf: string;
  claim: { orderId: string; buyerId: string; messages: string[] };
  order: { item: string; category: string; totalUsd: number } | null;
  scans: { scanId: string; code: string; at: string; note?: string; gpsMatchesAddress?: boolean | null }[];
  buyer: { accountAgeDays: number; dnrClaims12m: number };
  faults: Record<string, string> | null;
};
type Entry = { proposalId: string; caseId: string; orderId: string; amountUsd: number; reasonCode: string; status: string; createdAt: string; committedAt?: string; rejectedReason?: string };

const MODEL_LABEL: Record<string, string> = {
  replay: 'Recorded live LLM run (replay, no key)',
  scripted: 'Scripted agent (offline, deterministic)',
  'scripted-adversarial': 'Compromised model (obeys injected text)',
  live: 'Live LLM via AI SDK',
};
const OUTCOME_COPY: Record<string, { label: string; cls: string }> = {
  REFUND_ELIGIBLE: { label: 'Refund eligible', cls: 'ok' },
  WAIT_FOR_EVIDENCE: { label: 'Wait for evidence', cls: 'wait' },
  ESCALATE: { label: 'Escalate to a human', cls: 'esc' },
};

export default function Page() {
  const [cases, setCases] = useState<DemoCase[]>([]);
  const [sel, setSel] = useState('n01');
  const [model, setModel] = useState('replay');
  const [replayModel, setReplayModel] = useState('');
  const [live, setLive] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const traceEnd = useRef<HTMLDivElement>(null);

  const refreshLedger = useCallback(async () => {
    const r = await fetch('/api/ledger').then((x) => x.json());
    setLedger(r.entries); setLive(r.live); setReplayModel(r.replayModel ?? '');
  }, []);
  useEffect(() => { fetch('/api/cases').then((r) => r.json()).then(setCases); refreshLedger(); }, [refreshLedger]);
  useEffect(() => { traceEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [events.length]);

  const c = useMemo(() => cases.find((x) => x.id === sel), [cases, sel]);

  async function run() {
    setRunning(true); setEvents([]); setResult(null); setCommitMsg(null);
    const res = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: sel, model: model === 'replay' && !c?.replay ? 'scripted' : model }) });
    if (!res.ok || !res.body) { setCommitMsg((await res.json()).error ?? 'Run failed'); setRunning(false); return; }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) {
        const e = JSON.parse(l) as TraceEvent;
        setEvents((x) => [...x, e]);
        if (e.type === 'run-end') setResult(e.result);
      }
    }
    setRunning(false); refreshLedger();
  }

  async function confirm(proposalId: string) {
    const r = await fetch('/api/commit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proposalId }) }).then((x) => x.json());
    setCommitMsg(r.status === 'committed' ? `Simulated refund of $${r.entry.amountUsd.toFixed(2)} written to the case ledger. No money moved.`
      : r.status === 'already_committed' ? 'Already committed: this click was a no-op (idempotent).'
      : `Rejected at commit-time recheck: ${r.reason}`);
    refreshLedger();
  }
  async function resetLedger() { await fetch('/api/ledger', { method: 'DELETE' }); setCommitMsg(null); refreshLedger(); }

  const pending = result?.proposalId ? ledger.find((e) => e.proposalId === result.proposalId) : null;

  return (
    <main>
      <header className="top">
        <div>
          <h1>DNR Agent <span className="v">v2</span></h1>
          <p className="sub">A tool-calling agent for &ldquo;delivered but not received&rdquo; claims in the post-purchase experience. <b>The LLM gathers evidence and explains. Deterministic policy code decides. A human confirms.</b></p>
        </div>
        <div className="disclose" role="note">
          <b>Proof of concept.</b> Synthetic orders, carrier scans and buyers. Refunds are <b>simulated</b> entries in a local case ledger. This is not payments infrastructure and touches no real systems.
        </div>
      </header>

      <div className="grid">
        <aside className="cases">
          <h2>Scenarios</h2>
          {cases.map((x) => (
            <button key={x.id} className={`case ${x.id === sel ? 'on' : ''}`} onClick={() => { setSel(x.id); setEvents([]); setResult(null); setCommitMsg(null); }}>
              <span className="cl">{x.label}</span><span className="cb">{x.blurb}</span><span className="cid">eval case {x.id}</span>
            </button>
          ))}
          <div className="ledger">
            <div className="lh"><h2>Case ledger</h2><button className="link" onClick={resetLedger}>reset</button></div>
            {ledger.length === 0 && <p className="muted">Empty. Confirmed refunds appear here.</p>}
            {ledger.slice().reverse().map((e) => (
              <div key={e.proposalId} className={`le ${e.status}`}>
                <span>{e.orderId}</span><span>${e.amountUsd.toFixed(2)}</span><span className="st">{e.status.replace('_', ' ')}</span>
                {e.rejectedReason && <span className="rr">{e.rejectedReason}</span>}
              </div>
            ))}
          </div>
        </aside>

        <section className="center">
          {c && (
            <div className="card claim">
              <div className="row between"><h2>Claim · {c.claim.orderId}</h2><span className="muted">as of {c.asOf}</span></div>
              {c.claim.messages.map((m, i) => <blockquote key={i}><span className="tag untrusted">buyer · untrusted</span>{m}</blockquote>)}
              <div className="facts">
                {c.order ? <span>{c.order.item} · {c.order.category} · <b>${c.order.totalUsd.toFixed(2)}</b></span> : <span>Order not found</span>}
                <span>buyer: {c.buyer.accountAgeDays} days old, {c.buyer.dnrClaims12m} claims / 12 mo</span>
                {c.faults && <span className="warn">fault injected: {Object.entries(c.faults).map(([k, v]) => `${k} ${v}`).join(', ')}</span>}
              </div>
              <div className="scans">
                {c.scans.map((s) => (
                  <div key={s.scanId} className="scan"><code>{s.scanId}</code><span>{s.code.replace(/_/g, ' ')}</span><span className="muted">{s.at}</span>
                    {s.gpsMatchesAddress === false && <span className="warn">GPS mismatch</span>}
                    {s.note && <span className="note"><span className="tag untrusted">carrier note · untrusted</span>{s.note}</span>}
                  </div>
                ))}
              </div>
              <div className="row runbar">
                <select value={model === 'replay' && !c.replay ? 'scripted' : model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
                  <option value="replay" disabled={!c.replay}>{`Recorded ${replayModel || 'live LLM'} run (replay, no key)`}{c.replay ? '' : ' (not recorded)'}</option>
                  <option value="scripted">{MODEL_LABEL.scripted}</option>
                  <option value="scripted-adversarial">{MODEL_LABEL['scripted-adversarial']}</option>
                  <option value="live" disabled={!live}>{MODEL_LABEL.live}{live ? '' : ' (disabled in demo)'}</option>
                </select>
                <button className="primary" onClick={run} disabled={running}>{running ? 'Running…' : 'Run agent'}</button>
              </div>
            </div>
          )}

          <div className="card trace">
            <div className="row between"><h2>Tool trace</h2><span className="muted">tool calls and results, not chain-of-thought · cap 6 steps</span></div>
            {events.length === 0 && <p className="muted">Run the agent to see each tool call, its input, its output and its latency.</p>}
            <ol>
              {events.filter((e) => e.type !== 'tool-call').map((e, i) => {
                if (e.type === 'run-start') return <li key={i} className="ev start">Run started · model <b>{e.model.startsWith('replay:') ? `${e.model.slice(7)} (recorded responses replayed through live tools, policy and guards)` : MODEL_LABEL[e.model] ?? e.model}</b></li>;
                if (e.type === 'guard') return <li key={i} className={`ev guard ${e.level}`}><span className="gl">{e.level === 'blocked' ? 'BLOCKED' : 'GUARD'}</span>{e.message}</li>;
                if (e.type === 'tool-result') {
                  const call = events.find((x) => x.type === 'tool-call' && x.id === e.id) as Extract<TraceEvent, { type: 'tool-call' }> | undefined;
                  return (
                    <li key={i} className={`ev tool ${e.error ? 'err' : ''}`}>
                      <div className="th"><span className="step">step {e.step + 1}</span><code className="tn">{e.tool}</code><span className="muted">{e.ms} ms</span>{e.error && <span className="warn">{e.error}</span>}</div>
                      <details><summary>input {short(call?.input)}</summary><pre>{JSON.stringify(call?.input, null, 2)}</pre></details>
                      {!e.error && <details open={e.tool === 'check_policy' || e.tool === 'propose_refund'}><summary>output {short(e.output)}</summary><pre>{JSON.stringify(e.output, null, 2)}</pre></details>}
                    </li>
                  );
                }
                if (e.type === 'run-end') return <li key={i} className="ev start">Run finished · {e.result.steps} model steps · {e.result.toolCalls.length} tool calls · {e.result.latencyMs} ms</li>;
                return null;
              })}
            </ol>
            <div ref={traceEnd} />
          </div>
        </section>

        <section className="right">
          <div className="card outcome">
            <h2>Outcome</h2>
            {!result && <p className="muted">The outcome comes from the policy engine. The model may only make a case more conservative.</p>}
            {result && (
              <>
                <div className={`pill ${OUTCOME_COPY[result.finalOutcome].cls}`}>{OUTCOME_COPY[result.finalOutcome].label}{result.finalOutcome === 'REFUND_ELIGIBLE' && ` · $${result.finalAmountUsd.toFixed(2)}`}</div>
                <dl>
                  <dt>Reason</dt><dd><code>{result.policy?.reasonCode}</code></dd>
                  <dt>Rules fired</dt><dd>{result.policy?.rulesFired.map((r) => <code key={r} className="chip">{r}</code>)}</dd>
                  <dt>Evidence cited</dt><dd>{result.submission?.evidenceIds.length ? result.submission.evidenceIds.map((x) => <code key={x} className={`chip ${result.seenEvidenceIds.includes(x) ? '' : 'bad'}`}>{x}</code>) : <span className="muted">none</span>}</dd>
                  <dt>Policy</dt><dd className="muted">v{result.policy?.policyVersion}</dd>
                </dl>
                {result.blockedAttempts.length > 0 && <div className="blocked"><b>{result.blockedAttempts.length} blocked attempt{result.blockedAttempts.length > 1 ? 's' : ''}</b>{result.blockedAttempts.map((b, i) => <div key={i}><code>{b.tool}</code> {JSON.stringify(b.input)} → {b.reason}</div>)}</div>}
                {result.submission && <>
                  <h3>Reply to buyer (draft)</h3><p className="reply">{result.submission.buyerReply}</p>
                  <h3>Note for the reviewer</h3><p className="small">{result.submission.internalNote}</p>
                </>}
                {result.finalOutcome === 'REFUND_ELIGIBLE' && result.proposalId && (
                  <div className="confirm">
                    <p className="small">Proposal <code>{result.proposalId}</code> is <b>{pending?.status.replace('_', ' ') ?? 'pending'}</b>. Confirming rechecks the policy against source data, then writes one idempotent ledger entry.</p>
                    <button className="primary" onClick={() => confirm(result.proposalId!)} disabled={pending?.status === 'committed'}>{pending?.status === 'committed' ? 'Committed to the case ledger' : `Confirm simulated refund · $${result.finalAmountUsd.toFixed(2)}`}</button>
                  </div>
                )}
                {commitMsg && <p className="commitmsg">{commitMsg}</p>}
                <p className="small muted">{result.latencyMs} ms · {result.toolCalls.length} tool calls · {result.model.startsWith('scripted') ? 'scripted model: no LLM tokens' : result.model.startsWith('replay:') ? `replayed: ${result.usage.inputTokens + result.usage.outputTokens} tokens when recorded` : `${result.usage.inputTokens + result.usage.outputTokens} tokens · $${result.costUsd.toFixed(4)}`}</p>
              </>
            )}
          </div>
        </section>
      </div>
      <footer>Synthetic demo. LLM proposes and explains; policy code decides eligibility and amount; a human confirms. Evals: 90 versioned cases, see the repo README.</footer>
    </main>
  );
}

function short(x: unknown) {
  const s = JSON.stringify(x ?? null);
  return <span className="muted">{s.length > 70 ? s.slice(0, 70) + '…' : s}</span>;
}
