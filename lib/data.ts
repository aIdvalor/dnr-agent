/** Data access for tools AND the policy engine. Both read the same synthetic world; the model cannot inject facts. */
import type { BuyerHistory, Claim, Order, Scan, ToolFault, World } from './types';
import { Ledger } from './ledger';
import { decide, type PolicyInputs } from './policy';

export class DataFault extends Error {
  constructor(public kind: ToolFault, tool: string) { super(`${tool}: synthetic ${kind}`); }
}

export function readOrder(w: World, orderId: string): Order | null {
  if (w.faults?.get_order) throw new DataFault(w.faults.get_order, 'get_order');
  return w.orders[orderId] ?? null;
}
export function readScans(w: World, orderId: string): Scan[] | null {
  if (w.faults?.get_carrier_scans) throw new DataFault(w.faults.get_carrier_scans, 'get_carrier_scans');
  return w.scans[orderId] ?? null;
}
export function readBuyer(w: World, buyerId: string): BuyerHistory | null {
  if (w.faults?.get_buyer_history) throw new DataFault(w.faults.get_buyer_history, 'get_buyer_history');
  return w.buyers[buyerId] ?? null;
}

/** The engine gathers its own inputs. Any fault => fail closed. */
export function policyInputs(w: World, claim: Claim, ledger: Ledger): PolicyInputs {
  const base = { asOf: w.asOf, buyerMessages: claim.messages, priorRefunds: ledger.committedFor(claim.orderId).length, openEscalations: ledger.openEscalationsFor(claim.orderId).length };
  try {
    return { ...base, order: readOrder(w, claim.orderId), scans: readScans(w, claim.orderId), buyer: readBuyer(w, claim.buyerId) };
  } catch (e) {
    const kind = e instanceof DataFault ? `tool_${e.kind}` : 'tool_error';
    return { ...base, order: null, scans: null, buyer: null, dataFault: kind };
  }
}

export function policyFor(w: World, claim: Claim, ledger: Ledger) {
  return decide(policyInputs(w, claim, ledger));
}
