/** Shared types. Everything here is synthetic demo data: no real orders, carriers, buyers or money. */

export type Category = 'general' | 'electronics' | 'luxury';
export type Outcome = 'REFUND_ELIGIBLE' | 'WAIT_FOR_EVIDENCE' | 'ESCALATE';
export const OUTCOMES: Outcome[] = ['REFUND_ELIGIBLE', 'WAIT_FOR_EVIDENCE', 'ESCALATE'];

export type ScanCode =
  | 'label_created'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'return_to_sender';

export interface Order {
  orderId: string;
  buyerId: string;
  item: string;
  category: Category;
  totalUsd: number; // item + shipping, what a full refund would return
  shippedAt: string; // ISO date
  signatureRequired?: boolean;
}

export interface Scan {
  scanId: string;
  code: ScanCode;
  at: string; // ISO date
  /** Free text from the (synthetic) carrier. UNTRUSTED: never read by policy logic except for the injection detector. */
  note?: string;
  gpsMatchesAddress?: boolean | null;
  signatureObtained?: boolean;
}

export interface BuyerHistory {
  buyerId: string;
  accountAgeDays: number;
  orders12m: number;
  dnrClaims12m: number;
  chargebacks12m: number;
}

export type ToolFault = 'error' | 'timeout';

/** A self-contained synthetic world for one case. Tools and policy read only from here + the ledger. */
export interface World {
  asOf: string; // ISO date: "today" for this case
  orders: Record<string, Order>;
  scans: Record<string, Scan[]>;
  buyers: Record<string, BuyerHistory>;
  faults?: Partial<Record<'get_order' | 'get_carrier_scans' | 'get_buyer_history', ToolFault>>;
}

export interface Claim {
  caseId: string;
  orderId: string;
  buyerId: string;
  /** Buyer messages, oldest first. UNTRUSTED text. */
  messages: string[];
}

export interface PolicyDecision {
  policyVersion: string;
  outcome: Outcome;
  amountUsd: number; // 0 unless REFUND_ELIGIBLE
  reasonCode: string;
  rulesFired: string[];
  /** Scan ids the decision rests on; the agent must cite these. */
  requiredEvidence: string[];
  facts: Record<string, unknown>;
}

export type TraceEvent =
  | { type: 'run-start'; caseId: string; model: string; at: number }
  | { type: 'tool-call'; step: number; id: string; tool: string; input: unknown; at: number }
  | { type: 'tool-result'; step: number; id: string; tool: string; output: unknown; ms: number; error?: string; at: number }
  | { type: 'guard'; level: 'info' | 'blocked'; message: string; at: number }
  | { type: 'run-end'; result: RunResult; at: number };

export interface Submission {
  outcome: Outcome;
  amountUsd: number;
  evidenceIds: string[];
  buyerReply: string;
  internalNote: string;
}

export interface RunResult {
  caseId: string;
  model: string;
  policy: PolicyDecision | null; // the engine's decision, computed server-side even if the model never asked
  submission: Submission | null; // what the model submitted (null if it never did)
  finalOutcome: Outcome;
  finalAmountUsd: number;
  proposalId: string | null; // pending refund proposal awaiting a human, if any
  /** What the human Confirm action must present: the proposal and the state version it was made on. */
  approval: { proposalId: string; stateVersion: string } | null;
  blockedAttempts: { tool: string; reason: string; input: unknown }[];
  guardNotes: string[];
  toolCalls: { tool: string; input: unknown; ok: boolean; ms: number }[];
  seenEvidenceIds: string[];
  steps: number;
  finishedCleanly: boolean; // model called submit_outcome within the step cap with no fatal error
  error?: string;
  latencyMs: number;
  /** Time spent waiting on rate-limit pacing or 429 backoff (live only); excluded from latencyMs. */
  waitedMs?: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
}
