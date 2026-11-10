/**
 * File-backed case ledger for SIMULATED refunds. No money moves anywhere: an entry is a JSON record.
 * Writes are atomic (write temp + rename). Single-process PoC: no cross-process locking.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ProposalStatus = 'pending_human' | 'committed' | 'rejected';
export interface LedgerEntry {
  proposalId: string;
  idempotencyKey: string;
  caseId: string;
  orderId: string;
  amountUsd: number;
  reasonCode: string;
  policyVersion: string;
  status: ProposalStatus;
  createdAt: string;
  committedAt?: string;
  rejectedReason?: string;
  committedBy?: string;
}

export function idempotencyKey(orderId: string, amountUsd: number, reasonCode: string, policyVersion: string) {
  return createHash('sha256').update(JSON.stringify([orderId, amountUsd, reasonCode, policyVersion])).digest('hex').slice(0, 16);
}

export class Ledger {
  private entries: LedgerEntry[] = [];
  constructor(private file?: string) {
    if (file && fs.existsSync(file)) this.entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  private save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
    fs.renameSync(tmp, this.file);
  }
  all(): LedgerEntry[] { return this.entries.map((e) => ({ ...e })); }
  get(proposalId: string) { return this.entries.find((e) => e.proposalId === proposalId); }
  committedFor(orderId: string) { return this.entries.filter((e) => e.orderId === orderId && e.status === 'committed'); }

  /** Idempotent: the same (order, amount, reason, policy version) returns the existing open/committed proposal. */
  propose(p: Omit<LedgerEntry, 'proposalId' | 'idempotencyKey' | 'status' | 'createdAt'>): LedgerEntry {
    const key = idempotencyKey(p.orderId, p.amountUsd, p.reasonCode, p.policyVersion);
    const existing = this.entries.find((e) => e.idempotencyKey === key && e.status !== 'rejected');
    if (existing) return { ...existing };
    const e: LedgerEntry = { ...p, proposalId: `prop_${randomUUID().slice(0, 8)}`, idempotencyKey: key, status: 'pending_human', createdAt: new Date().toISOString() };
    this.entries.push(e); this.save();
    return { ...e };
  }
  markCommitted(proposalId: string, by: string) {
    const e = this.get(proposalId)!; e.status = 'committed'; e.committedAt = new Date().toISOString(); e.committedBy = by; this.save(); return { ...e };
  }
  markRejected(proposalId: string, reason: string) {
    const e = this.get(proposalId)!; e.status = 'rejected'; e.rejectedReason = reason; this.save(); return { ...e };
  }
  /** Test/demo helper: seed a committed refund (e.g. for duplicate-claim cases). */
  seedCommitted(e: Pick<LedgerEntry, 'caseId' | 'orderId' | 'amountUsd' | 'reasonCode'>) {
    const p = this.propose({ ...e, policyVersion: 'seed' });
    return this.markCommitted(p.proposalId, 'seed');
  }
  reset() { this.entries = []; this.save(); }
}
