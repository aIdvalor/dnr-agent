import { MockLanguageModelV4 } from 'ai/test';
import { vi } from 'vitest';
import * as models from '../../lib/models';

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
let k = 0;
export const tc = (toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: `t${++k}`, toolName, input: JSON.stringify(input) });

/** A model that plays a fixed list of steps (each a list of tool calls), then repeats `rest` forever (default: stop). */
export function seqModel(steps: any[][], o: { delayMs?: number; rest?: any[] | 'stop'; signalAware?: boolean } = {}) {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }: any) => {
      if (o.delayMs) await new Promise((r, rej) => { const t = setTimeout(r, o.delayMs); abortSignal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
      const step = i < steps.length ? steps[i] : o.rest && o.rest !== 'stop' ? o.rest.map((c: any) => ({ ...c, toolCallId: `r${++k}` })) : null;
      i++;
      if (!step) return { content: [{ type: 'text', text: 'done' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] } as any;
      return { content: step, finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] } as any;
    },
  });
}
export function useModel(m: MockLanguageModelV4) {
  return vi.spyOn(models, 'getModel').mockReturnValue({ model: m, id: 'mock', live: false, pricePerMTok: { input: 0, output: 0 } });
}
export const reads = (orderId = 'O1', buyerId = 'B1') => [tc('get_order', { orderId }), tc('get_carrier_scans', { orderId }), tc('get_buyer_history', { buyerId })];
