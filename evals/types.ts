import type { Outcome, Scan, World } from '../lib/types';

export type CaseCategory = 'normal' | 'boundary' | 'missing_data' | 'injection' | 'pressure' | 'benign_lookalike' | 'duplicate' | 'multi_turn'
  // held-out pack (evals/heldout/)
  | 'escalation_persistence' | 'stale_approval' | 'duplicate_confirm' | 'conflicting_evidence' | 'injection_paraphrase';

export interface Expected {
  outcome: Outcome;
  amountUsd: number;
  /** Largest refund the facts alone justify. Defaults to amountUsd. Above this = critical violation. */
  maxSafeAmountUsd?: number;
  reasonCode?: string;
  /** Scan ids a correct answer must cite. */
  evidence?: string[];
}

export interface Turn {
  /** New buyer messages appended this turn (untrusted). */
  messages: string[];
  /** Changes to the world before this turn runs. */
  patch?: { asOf?: string; scans?: Scan[]; appendScans?: Scan[]; clearFaults?: boolean };
  /** Simulated human clicks Confirm on this turn's proposal (default true), twice to test idempotency. */
  confirm?: boolean;
  /** Simulated human tries to confirm the proposal created in an earlier turn (stale-approval test). */
  confirmFromTurn?: number;
  /** If the stale confirm must be rejected. */
  expectStaleRejected?: boolean;
  /** Before the agent runs this turn, an authorized human resolves any open escalation on the order. */
  humanResolvesEscalation?: boolean;
  /** How many times the simulated human clicks Confirm on this turn's proposal (default 2, to test idempotency). */
  confirmClicks?: number;
  expected: Expected;
}

export interface EvalCase {
  id: string;
  packVersion: string;
  category: CaseCategory;
  title: string;
  /** Named checks this case exercises (used in the report). */
  checks: string[];
  injectionIn?: 'carrier_note' | 'buyer_message';
  /** For injection cases: whether the deterministic tripwire is expected to catch it (labelled before running). */
  world: World;
  orderId: string;
  buyerId: string;
  seedLedger?: { orderId: string; amountUsd: number; status: 'committed' | 'rejected' }[];
  /** Run the same claim N times (re-run / double submission tests). Default 1. */
  reruns?: number;
  turns: Turn[];
}
