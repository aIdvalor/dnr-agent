/**
 * Deterministic DNR policy engine. Pure functions over policy.json + tool data.
 * The model never computes eligibility, caps or amounts. It cannot pass facts in: the engine
 * fetches its own inputs from the same data sources the tools use.
 */
import policyJson from '../policy.json';
import type { BuyerHistory, Category, Order, PolicyDecision, Scan } from './types';
import { detectInstructionLikeText } from './injection';
import { tripwireDisabled } from './ablation';

export const POLICY = policyJson;
const P = policyJson;

export type Risk = 'low' | 'medium' | 'high';
const ORDER_OF: Record<string, number> = { label_created: 0, in_transit: 1, out_for_delivery: 2, delivered: 3 };

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export function buyerRisk(h: BuyerHistory, totalUsd: number): Risk {
  const r = P.buyer_risk;
  if (h.dnrClaims12m >= r.high_claims_12m) return 'high';
  if (h.chargebacks12m >= r.chargeback_pattern.min_chargebacks_12m && h.dnrClaims12m >= r.chargeback_pattern.min_claims_12m) return 'high';
  if (h.accountAgeDays <= r.new_account_days && totalUsd >= r.new_account_high_min_value_usd) return 'high';
  if (h.dnrClaims12m >= r.medium_claims_12m || h.accountAgeDays <= r.medium_account_age_days) return 'medium';
  return 'low';
}

export function refundCap(category: Category, risk: Risk): number | null {
  return (P.refund_cap_usd as unknown as Record<Category, Record<Risk, number | null>>)[category][risk];
}

/** Carrier scans must be chronological and in a plausible lifecycle order. */
export function scanSequenceValid(scans: Scan[]): boolean {
  for (let i = 1; i < scans.length; i++) {
    if (Date.parse(scans[i].at) < Date.parse(scans[i - 1].at)) return false;
    const a = ORDER_OF[scans[i - 1].code], b = ORDER_OF[scans[i].code];
    if (a !== undefined && b !== undefined && b < a) return false;
  }
  return new Set(scans.map((s) => s.scanId)).size === scans.length;
}

export interface PolicyInputs {
  asOf: string;
  order: Order | null;
  scans: Scan[] | null;
  buyer: BuyerHistory | null;
  buyerMessages: string[];
  /** Committed refunds already on the ledger for this order. */
  priorRefunds: number;
  dataFault?: string; // tool_error / tool_timeout etc. observed while fetching inputs
}

export function decide(i: PolicyInputs): PolicyDecision {
  const fired: string[] = [];
  const base = { policyVersion: P.version };
  const out = (outcome: PolicyDecision['outcome'], reasonCode: string, evidence: string[] = [], amountUsd = 0, facts: Record<string, unknown> = {}): PolicyDecision => ({
    ...base, outcome, amountUsd, reasonCode, rulesFired: [...fired, reasonCode], requiredEvidence: evidence, facts,
  });

  // 1. Fail closed on missing/broken data.
  if (i.dataFault) return out('ESCALATE', 'FAIL_CLOSED_DATA', [], 0, { fault: i.dataFault });
  if (!i.order) return out('ESCALATE', 'FAIL_CLOSED_DATA', [], 0, { fault: 'unknown_order' });
  if (!i.buyer || !i.scans) return out('ESCALATE', 'FAIL_CLOSED_DATA', [], 0, { fault: 'missing_inputs' });
  const { order, scans, buyer } = i;
  if (order.buyerId !== buyer.buyerId) return out('ESCALATE', 'FAIL_CLOSED_DATA', [], 0, { fault: 'buyer_order_mismatch' });
  if (!scanSequenceValid(scans)) return out('ESCALATE', 'FAIL_CLOSED_DATA', scans.map((s) => s.scanId), 0, { fault: 'invalid_scan_sequence' });

  // 2. One refund per order, ever. A repeat claim goes to a human.
  if (i.priorRefunds > 0) return out('ESCALATE', 'DUPLICATE_CLAIM', [], 0, { priorRefunds: i.priorRefunds });

  // 3. Instruction-like text anywhere in untrusted text -> a human looks. Detection is a tripwire, not the safety boundary:
  //    amounts below never read free text, so a missed injection still cannot change the money.
  const noteHits = scans.filter((s) => s.note && detectInstructionLikeText(s.note, 'carrier_note').flagged);
  const msgHit = i.buyerMessages.map((m) => detectInstructionLikeText(m, 'buyer_message')).find((d) => d.flagged);
  if ((noteHits.length || msgHit) && !tripwireDisabled()) {
    const where = noteHits.length ? 'carrier_note' : 'buyer_message';
    return out('ESCALATE', 'INSTRUCTION_LIKE_TEXT', noteHits.map((s) => s.scanId), 0, { where });
  }

  const risk = buyerRisk(buyer, order.totalUsd);
  const facts: Record<string, unknown> = { risk, totalUsd: order.totalUsd, category: order.category };
  const last = scans[scans.length - 1];
  const delivered = scans.find((s) => s.code === 'delivered');
  const rts = scans.find((s) => s.code === 'return_to_sender');

  // 4. Not delivered.
  if (!delivered) {
    if (rts) return capOrRefund('RETURN_TO_SENDER', [rts.scanId]);
    if (!last) {
      const d = daysBetween(order.shippedAt, i.asOf);
      facts.daysSinceShipped = d;
      if (d < P.label_only_stale_days) return out('WAIT_FOR_EVIDENCE', 'NO_CARRIER_DATA_YET', [], 0, facts);
      return out('ESCALATE', 'NO_CARRIER_DATA_STALE', [], 0, facts);
    }
    const age = daysBetween(last.at, i.asOf);
    facts.daysSinceLastScan = age;
    if (last.code === 'label_created') {
      if (age >= P.label_only_stale_days) return capOrRefund('NEVER_SHIPPED', [last.scanId]);
      return out('WAIT_FOR_EVIDENCE', 'LABEL_ONLY_RECENT', [last.scanId], 0, facts);
    }
    if (age < P.in_transit_grace_days) return out('WAIT_FOR_EVIDENCE', 'IN_TRANSIT', [last.scanId], 0, facts);
    return capOrRefund('STALLED_IN_TRANSIT', [last.scanId]);
  }

  // 5. Delivered scan exists.
  const days = daysBetween(delivered.at, i.asOf);
  facts.daysSinceDelivery = days;
  if (days > P.policy_window_days) return out('ESCALATE', 'OUTSIDE_POLICY_WINDOW', [delivered.scanId], 0, facts);
  if (delivered.signatureObtained || order.signatureRequired) return out('ESCALATE', 'SIGNATURE_ON_FILE', [delivered.scanId], 0, facts);
  const gpsMismatch = delivered.gpsMatchesAddress === false;
  if (!gpsMismatch && days < P.wait_days_after_delivery) return out('WAIT_FOR_EVIDENCE', 'INSIDE_WAIT_WINDOW', [delivered.scanId], 0, facts);
  return capOrRefund(gpsMismatch ? 'GPS_MISMATCH' : 'WAIT_WINDOW_ELAPSED', [delivered.scanId]);

  function capOrRefund(reason: string, evidence: string[]): PolicyDecision {
    fired.push(reason);
    if (risk === 'high') return out('ESCALATE', 'HIGH_BUYER_RISK', evidence, 0, facts);
    const cap = refundCap(order.category, risk);
    facts.capUsd = cap;
    if (cap === null || order.totalUsd >= cap) return out('ESCALATE', 'ABOVE_AUTONOMOUS_CAP', evidence, 0, facts);
    // Amount is always the order total: the engine never takes an amount from text.
    return { ...out('REFUND_ELIGIBLE', reason, evidence, order.totalUsd, facts), rulesFired: [...fired] };
  }
}
