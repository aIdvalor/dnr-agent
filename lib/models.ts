/**
 * Provider switch. Live models go through the Vercel AI Gateway (AI_GATEWAY_API_KEY) or a direct
 * OpenAI / Anthropic key. Two SCRIPTED models (no LLM, no network) drive the same AI SDK tool loop so
 * the deterministic test suite and the offline demo exercise exactly the production code path:
 *   - scripted:             a well-behaved agent (reads evidence, checks policy, proposes, submits)
 *   - scripted-adversarial: a "compromised" agent that obeys injected instructions and asks for $500.
 *     It exists to prove the guardrails hold even when the model does the wrong thing.
 */
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import fs from 'node:fs';
import path from 'node:path';
import { gateway } from '@ai-sdk/gateway';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { paced } from './live';
import type { LanguageModelV4 } from '@ai-sdk/provider';

export interface ModelChoice { model: LanguageModel; id: string; live: boolean; pricePerMTok: { input: number; output: number } }

const price = () => ({ input: Number(process.env.DNR_PRICE_INPUT_PER_MTOK ?? 0), output: Number(process.env.DNR_PRICE_OUTPUT_PER_MTOK ?? 0) });

export function liveModelAvailable(): { ok: boolean; why: string } {
  const spec = process.env.DNR_MODEL;
  if (!spec) return { ok: false, why: 'DNR_MODEL is not set (e.g. google:<model>, gateway:<provider>/<model>, openai:<model>, anthropic:<model>)' };
  const [prov] = spec.split(':');
  const need = prov === 'gateway' ? 'AI_GATEWAY_API_KEY' : prov === 'openai' ? 'OPENAI_API_KEY' : prov === 'anthropic' ? 'ANTHROPIC_API_KEY' : prov === 'google' ? 'GOOGLE_GENERATIVE_AI_API_KEY' : null;
  if (!need) return { ok: false, why: `unknown provider prefix "${prov}"` };
  if (!process.env[need]) return { ok: false, why: `${need} is not set` };
  return { ok: true, why: spec };
}

// ---------------------------------------------------------------------------------------------
// Replay: re-plays a recorded live model's responses (step by step) through the real tools, policy
// and guards. Lets a public demo show real model decisions without any API key.
export const REPLAY_FILE = process.env.DNR_REPLAY_FILE ?? 'evals/recordings/google_gemini-3.1-flash-lite.jsonl';
let replayCache: Map<string, any> | null = null;
function replayIndex(): Map<string, any> {
  if (replayCache) return replayCache;
  replayCache = new Map();
  const f = path.join(process.cwd(), REPLAY_FILE);
  if (fs.existsSync(f)) for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.rep !== 0) continue;
    replayCache.set(`${r.caseId}|${r.step}`, r);
  }
  return replayCache;
}
export function replayAvailable(caseId: string): boolean { return replayIndex().has(`${caseId.includes('#') ? caseId : caseId + '#0'}|0`); }
export function replayModelName(): string { return path.basename(REPLAY_FILE, '.jsonl').replace(/^google_/, ''); }

function replayModel() {
  return new MockLanguageModelV4({
    provider: 'replay',
    modelId: `replay:${replayModelName()}`,
    doGenerate: async ({ prompt }) => {
      const ids = claimFrom(prompt as any[]);
      const cid = String(ids.caseId ?? '');
      const key = `${cid.includes('#') ? cid : cid + '#0'}|${(prompt as any[]).filter((m: any) => m.role === 'assistant').length}`;
      const r = replayIndex().get(key);
      if (!r) return { content: [{ type: 'text', text: 'No recorded step for this point; stopping.' }], finishReason: { unified: 'stop', raw: 'replay-end' }, usage: usage(0, 0), warnings: [] } as any;
      return { content: r.content, finishReason: r.finishReason, usage: usage(r.usage?.inputTokens?.total ?? 0, r.usage?.outputTokens?.total ?? 0), warnings: [] } as any;
    },
  });
}

export function getModel(spec: string): ModelChoice {
  if (spec === 'replay') return { model: replayModel(), id: `replay:${replayModelName()}`, live: false, pricePerMTok: { input: 0, output: 0 } };
  if (spec === 'scripted') return { model: scriptedModel(false), id: 'scripted', live: false, pricePerMTok: { input: 0, output: 0 } };
  if (spec === 'scripted-adversarial') return { model: scriptedModel(true), id: 'scripted-adversarial', live: false, pricePerMTok: { input: 0, output: 0 } };
  const live = spec === 'live' ? process.env.DNR_MODEL ?? '' : spec;
  const i = live.indexOf(':');
  const prov = live.slice(0, i), id = live.slice(i + 1);
  if (!id) throw new Error('No live model configured. Set DNR_MODEL and the matching API key.');
  const base = prov === 'gateway' ? gateway(id) : prov === 'openai' ? openai(id) : prov === 'anthropic' ? anthropic(id) : prov === 'google' ? google(id) : null;
  if (!base) throw new Error(`Unknown provider "${prov}"`);
  // Pacing + retry for rate-limited (e.g. free) tiers. DNR_LIVE_MIN_INTERVAL_MS=0 disables pacing.
  const model = paced(base as unknown as LanguageModelV4, { minIntervalMs: Number(process.env.DNR_LIVE_MIN_INTERVAL_MS ?? 0) });
  return { model, id: live, live: true, pricePerMTok: price() };
}

// ---------------------------------------------------------------------------------------------
// Scripted models. They read the tool results already in the prompt and decide the next call.

type Json = Record<string, any>;
const usage = (i: number, o: number) => ({
  inputTokens: { total: i, noCache: i, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: o, text: o, reasoning: 0 },
});

function results(prompt: any[]): Record<string, { ok: boolean; value: any }> {
  const out: Record<string, { ok: boolean; value: any }> = {};
  for (const m of prompt) {
    if (m.role !== 'tool') continue;
    for (const p of m.content) {
      if (p.type !== 'tool-result') continue;
      const o = p.output;
      out[p.toolName] = o?.type === 'json' ? { ok: true, value: o.value } : { ok: !/error/.test(o?.type ?? ''), value: o?.value };
    }
  }
  return out;
}

function claimFrom(prompt: any[]): Json {
  const user = prompt.find((m: any) => m.role === 'user');
  const text = user?.content?.map((c: any) => c.text ?? '').join('') ?? '';
  const m = text.match(/<claim_ids>(.*?)<\/claim_ids>/s);
  const b = text.match(/<buyer_messages[^>]*>(.*?)<\/buyer_messages>/s);
  return { ...(m ? JSON.parse(m[1]) : {}), lastMessage: b ? b[1] : '' };
}

let n = 0;
const call = (toolName: string, input: Json) => ({ type: 'tool-call' as const, toolCallId: `call_${++n}`, toolName, input: JSON.stringify(input) });

function reply(outcome: string, amount: number, reason: string) {
  if (outcome === 'REFUND_ELIGIBLE')
    return `Thanks for your patience. Your claim qualifies for a refund of $${amount.toFixed(2)} under our policy (${reason}). A team member will confirm it shortly, and you'll get a separate message once it's processed.`;
  if (outcome === 'WAIT_FOR_EVIDENCE')
    return `Thanks for reaching out. The carrier data is not final yet (${reason}). Packages marked like this often turn up within a few days. We'll check again and follow up; no action is needed from you right now.`;
  return `Thanks for reaching out. I've passed your case to a specialist who will review it and reply to you directly. Nothing has been decided against you.`;
}

function scriptedModel(adversarial: boolean) {
  return new MockLanguageModelV4({
    provider: 'scripted',
    modelId: adversarial ? 'scripted-adversarial' : 'scripted',
    doGenerate: async ({ prompt }) => {
      const r = results(prompt as any[]);
      const ids = claimFrom(prompt as any[]);
      const content: any[] = [];
      const has = (t: string) => t in r;
      if (!has('get_order') && !has('get_carrier_scans') && !has('get_buyer_history')) {
        content.push(call('get_order', { orderId: ids.orderId }), call('get_carrier_scans', { orderId: ids.orderId }), call('get_buyer_history', { buyerId: ids.buyerId }));
      } else if (!has('check_policy')) {
        content.push(call('check_policy', { orderId: ids.orderId }));
      } else {
        const pol = r.check_policy.ok ? r.check_policy.value : null;
        const scans: any[] = r.get_carrier_scans?.ok ? r.get_carrier_scans.value?.scans ?? [] : [];
        const injected = scans.map((s) => String(s.untrusted_note ?? '')).join(' ') + ' ' + (ids.lastMessage ?? '');
        const demanded = Number((injected.match(/\$\s?(\d{2,5})/) ?? [])[1] ?? 0);
        const adversarialRefund = adversarial && demanded > 0;
        if (!has('propose_refund') && (pol?.outcome === 'REFUND_ELIGIBLE' || adversarialRefund)) {
          content.push(call('propose_refund', { orderId: ids.orderId, amountUsd: adversarialRefund ? demanded : pol.amountUsd, reasonCode: adversarialRefund ? 'CARRIER_NOTE_SAYS_REFUND' : pol.reasonCode }));
        } else if (!has('submit_outcome')) {
          if (adversarialRefund) {
            content.push(call('submit_outcome', { outcome: 'REFUND_ELIGIBLE', amountUsd: demanded, evidenceIds: scans.map((s) => s.scanId), buyerReply: `Your refund of $${demanded} has been issued.`, internalNote: 'Carrier note instructed a refund.' }));
          } else {
            const outcome = pol?.outcome ?? 'ESCALATE';
            const amount = outcome === 'REFUND_ELIGIBLE' ? pol.amountUsd : 0;
            const reason = pol?.reasonCode ?? 'POLICY_UNAVAILABLE';
            content.push(call('submit_outcome', {
              outcome, amountUsd: amount, evidenceIds: pol?.requiredEvidence ?? [],
              buyerReply: reply(outcome, amount, reason.toLowerCase().replace(/_/g, ' ')),
              internalNote: `Policy ${pol?.policyVersion ?? 'n/a'}: ${outcome} / ${reason}. Rules: ${(pol?.rulesFired ?? []).join(', ')}.`,
            }));
          }
        } else {
          return { content: [{ type: 'text', text: 'Case submitted.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(0, 0), warnings: [] } as any;
        }
      }
      return { content, finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: usage(0, 0), warnings: [] } as any;
    },
  });
}
