/**
 * Live-model wrapper: free-tier pacing, 429/5xx retry with backoff, daily-quota detection, and
 * recording of every model response so a public demo can replay real model decisions without a key.
 * Never logs request headers or keys.
 */
import type { LanguageModelV4 } from '@ai-sdk/provider';

export class QuotaExhaustedError extends Error {}
export const liveState = { quotaExhausted: false, waitedMs: 0, retries: 0, calls: 0, quotaInfo: [] as string[] };

export interface RecordedResponse { caseId: string; step: number; content: unknown[]; finishReason: unknown; usage: unknown; ms: number }
let recorder: ((r: RecordedResponse) => void) | null = null;
export function setRecorder(fn: typeof recorder) { recorder = fn; }

let lastCallAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function caseIdFrom(prompt: any[]): string {
  const user = prompt.find((m: any) => m.role === 'user');
  const text = user?.content?.map((c: any) => c.text ?? '').join('') ?? '';
  const m = text.match(/<claim_ids>(.*?)<\/claim_ids>/s);
  try { return m ? JSON.parse(m[1]).caseId : 'unknown'; } catch { return 'unknown'; }
}
const stepOf = (prompt: any[]) => prompt.filter((m: any) => m.role === 'assistant').length;

function retryDelayMs(body: string | undefined): number | null {
  const m = body?.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

export function paced(inner: LanguageModelV4, o: { minIntervalMs: number; maxRetries?: number }): LanguageModelV4 {
  const maxRetries = o.maxRetries ?? 6;
  return {
    specificationVersion: 'v4',
    provider: inner.provider,
    modelId: inner.modelId,
    get supportedUrls() { return inner.supportedUrls; },
    doStream: (opts) => inner.doStream(opts),
    doGenerate: async (opts) => {
      for (let attempt = 0; ; attempt++) {
        if (liveState.quotaExhausted) throw new QuotaExhaustedError('daily quota exhausted');
        const wait = Math.max(0, lastCallAt + o.minIntervalMs - Date.now());
        if (wait) { liveState.waitedMs += wait; await sleep(wait); }
        lastCallAt = Date.now();
        const t0 = Date.now();
        try {
          liveState.calls++;
          const r = await inner.doGenerate(opts);
          recorder?.({ caseId: caseIdFrom(opts.prompt as any[]), step: stepOf(opts.prompt as any[]), content: r.content, finishReason: r.finishReason, usage: r.usage, ms: Date.now() - t0 });
          return r;
        } catch (e: any) {
          const status = e?.statusCode as number | undefined;
          const body = String(e?.responseBody ?? '');
          if (status === 429) {
            const ids = [...body.matchAll(/"quotaId"\s*:\s*"([^"]+)"[\s\S]*?"quotaValue"\s*:\s*"?(\d+)/g)].map((m) => `${m[1]}=${m[2]}`);
            for (const q of ids) if (!liveState.quotaInfo.includes(q)) liveState.quotaInfo.push(q);
            if (process.env.DNR_LIVE_DEBUG) console.error(`[live] 429 ${ids.join(' ') || body.slice(0, 200).replace(/\s+/g, ' ')}`);
          }
          if (status === 429 && /PerDay|per day|RequestsPerDay|daily/i.test(body)) { liveState.quotaExhausted = true; throw new QuotaExhaustedError('daily quota exhausted'); }
          const network = e?.name !== 'AbortError' && /ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(String(e?.message));
          const retryable = status === 429 || (status !== undefined && status >= 500) || network;
          if (!retryable || attempt >= maxRetries) {
            // Status and a short body excerpt only: never request headers (they carry the key).
            if (process.env.DNR_LIVE_DEBUG) console.error(`[live] giving up: ${status ?? e?.name} ${String(e?.message ?? '').slice(0, 160).replace(/\s+/g, ' ')}`);
            throw e;
          }
          const d = Math.min(90_000, retryDelayMs(body) ?? 2000 * 2 ** attempt) + Math.floor(Math.random() * 500);
          liveState.retries++; liveState.waitedMs += d;
          await sleep(d);
        }
      }
    },
  };
}
