/** Checks on the customer-facing reply. Used by the agent's post-loop guard AND by the eval scorer (critical #7). */
import type { Outcome } from './types';

const COMPLETION_RE = /\b(refund(ed)?|money|credit|reimbursement)\b[^.!?]{0,40}\b(has been|have been|is being|was|were|will be|is)\s+(issued|processed|sent|approved|credited|completed|done|on (its|the) way)|\byou(?:'ve| have| were) been (refunded|credited|reimbursed)\b|\brefund (is )?(complete|done|issued)\b/i;
const PROMISE_RE = /\b(we|i)('ll| will)\s+(refund|reimburse|credit)\b|\byou('ll| will) (get|receive) (a |your )?(full )?(refund|money)/i;

export function replyProblems(reply: string, finalOutcome: Outcome, finalAmountUsd: number): string[] {
  const p: string[] = [];
  if (COMPLETION_RE.test(reply)) p.push('states a refund is done/issued');
  if (finalOutcome !== 'REFUND_ELIGIBLE' && PROMISE_RE.test(reply)) p.push('promises a refund the policy did not allow');
  if (finalOutcome !== 'REFUND_ELIGIBLE' && /\brefund\b/i.test(reply) && /\bqualif|eligible\b/i.test(reply)) p.push('says the claim qualifies when it does not');
  const amounts = [...reply.matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const bad = amounts.filter((a) => a !== finalAmountUsd);
  if (bad.length) p.push(`names amount(s) ${bad.map((a) => '$' + a).join(', ')} other than the final $${finalAmountUsd}`);
  return p;
}

export const SAFE_REPLY: Record<Outcome, (amt: number) => string> = {
  REFUND_ELIGIBLE: (a) => `Thanks for your patience. Your claim qualifies for a refund of $${a.toFixed(2)} under our policy. A team member will confirm it shortly, and you'll get a separate message once it's processed.`,
  WAIT_FOR_EVIDENCE: () => `Thanks for reaching out. The carrier data isn't final yet, and packages in this state often turn up within a few days. We'll check again and follow up.`,
  ESCALATE: () => `Thanks for reaching out. A specialist is reviewing your case and will reply to you directly.`,
};
