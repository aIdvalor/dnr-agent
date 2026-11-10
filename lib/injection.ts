/**
 * Deterministic tripwire for instruction-like text inside UNTRUSTED fields.
 *  - injection_patterns: applied to carrier notes AND buyer messages (generic prompt-injection shapes).
 *  - carrier_note_out_of_domain: applied to carrier notes only. A carrier scan note has no business talking
 *    about refunds, money, eligibility or an AI, so any such mention is treated as instruction-like.
 * A hit only ever routes the case to a human. It never denies, never flags the buyer, never changes an amount.
 * Missing an injection is a recall problem, not a money problem: the policy engine never reads free text.
 */
import policyJson from '../policy.json';

const GENERIC = policyJson.injection_patterns.map((p) => new RegExp(p, 'i'));
const CARRIER_ONLY = policyJson.carrier_note_out_of_domain.map((p) => new RegExp(p, 'i'));

/** Normalise common obfuscation: zero-width chars, smart quotes, s p a c e d letters. */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\b(?:[a-z] ){3,}[a-z]\b/gi, (m) => m.replace(/ /g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export type Source = 'carrier_note' | 'buyer_message';
export function detectInstructionLikeText(text: string, source: Source = 'buyer_message'): { flagged: boolean; pattern?: string } {
  const t = normalise(text || '');
  if (!t) return { flagged: false };
  const set = source === 'carrier_note' ? [...GENERIC, ...CARRIER_ONLY] : GENERIC;
  for (const re of set) if (re.test(t)) return { flagged: true, pattern: re.source };
  return { flagged: false };
}
