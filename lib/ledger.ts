/**
 * File-backed case ledger for SIMULATED refunds. No money moves anywhere: an entry is a JSON record.
 *
 * Write discipline (PoC scope, disclosed in the README):
 *  - every mutation runs inside `transact()`: take an exclusive lock file, RELOAD the ledger from disk,
 *    apply the change, write temp + rename, release the lock. Two Ledger objects (or two processes on
 *    the same host) pointing at the same file therefore cannot overwrite each other's commits.
 *  - the lock is a single-host `O_EXCL` lock file with a stale-lock timeout. It is not a distributed lock,
 *    and a crash between rename and unlock leaves a lock that expires after LOCK_STALE_MS.
 *  - in-memory ledgers (no file, used by evals/tests) are single-threaded JS and need no lock.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ProposalStatus = 'pending_human' | 'committed' | 'rejected' | 'escalated' | 'escalation_resolved';
export interface LedgerEntry {
  proposalId: string;
  idempotencyKey: string;
  caseId: string;
  orderId: string;
  amountUsd: number;
  reasonCode: string;
  policyVersion: string;
  /** Hash of the facts the proposal was made on (see stateVersion in lib/data.ts). A human approval binds to it. */
  stateVersion?: string;
  status: ProposalStatus;
  createdAt: string;
  committedAt?: string;
  rejectedReason?: string;
  committedBy?: string;
}

export function idempotencyKey(orderId: string, amountUsd: number, reasonCode: string, policyVersion: string) {
  return createHash('sha256').update(JSON.stringify([orderId, amountUsd, reasonCode, policyVersion])).digest('hex').slice(0, 16);
}

export const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const nap = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class LedgerBusyError extends Error {}

/** Ids: random by default; DNR_DETERMINISTIC_IDS=1 (static demo build) makes them a counter so recorded paths line up. */
let idCounter = 0;
export function resetIds() { idCounter = 0; }
const newId = () => (process.env.DNR_DETERMINISTIC_IDS === '1' ? String(++idCounter).padStart(8, '0') : randomUUID().slice(0, 8));

export class Ledger {
  private entries: LedgerEntry[] = [];
  private depth = 0;
  constructor(private file?: string) { this.load(); }
  private load() {
    if (this.file && fs.existsSync(this.file)) this.entries = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  private save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomUUID().slice(0, 6)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
    fs.renameSync(tmp, this.file);
  }
  private lock(): () => void {
    if (!this.file) return () => {};
    const lf = `${this.file}.lock`;
    fs.mkdirSync(path.dirname(lf), { recursive: true });
    const t0 = Date.now();
    for (;;) {
      try { const fd = fs.openSync(lf, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return () => { try { fs.unlinkSync(lf); } catch { /* already gone */ } }; }
      catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
        try { if (Date.now() - fs.statSync(lf).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lf); continue; } } catch { continue; }
        if (Date.now() - t0 > LOCK_WAIT_MS) throw new LedgerBusyError('ledger is locked by another writer');
        nap(5);
      }
    }
  }
  /** Serialized read-modify-write. Reloads from disk inside the lock so the callback sees every committed write. */
  transact<T>(fn: () => T): T {
    if (this.depth > 0) return fn(); // re-entrant within one transaction
    const unlock = this.lock();
    this.depth++;
    try { this.load(); const r = fn(); this.save(); return r; }
    finally { this.depth--; unlock(); }
  }
  /** Re-read the file (outside a transaction). */
  refresh() { this.load(); return this; }

  all(): LedgerEntry[] { return this.entries.map((e) => ({ ...e })); }
  get(proposalId: string) { return this.entries.find((e) => e.proposalId === proposalId); }
  committedFor(orderId: string) { return this.entries.filter((e) => e.orderId === orderId && e.status === 'committed'); }
  /** Open human handoffs for this order. While one is open, no later run may queue or commit money for the order. */
  openEscalationsFor(orderId: string) { return this.entries.filter((e) => e.orderId === orderId && e.status === 'escalated'); }

  /** Record that a run ended in ESCALATE: the order now belongs to a human until they resolve it. Amount is always 0. */
  markEscalated(p: { caseId: string; orderId: string; reasonCode: string; policyVersion: string }): LedgerEntry {
    return this.transact(() => {
      const open = this.openEscalationsFor(p.orderId)[0];
      if (open) return { ...open };
      const e: LedgerEntry = { ...p, amountUsd: 0, proposalId: `esc_${newId()}`, idempotencyKey: `esc:${p.orderId}:${newId()}`, status: 'escalated', createdAt: new Date().toISOString() };
      this.entries.push(e);
      return { ...e };
    });
  }
  /**
   * Human action: close the handoff so the order can be evaluated again. The ONLY way an open escalation is cleared.
   * `by` must name a human actor (`human:<id>`); the model has no tool that reaches this method.
   */
  resolveEscalations(orderId: string, by: string) {
    if (!/^human:[\w.-]+$/.test(by)) throw new Error(`resolveEscalations requires a human actor (got "${by}")`);
    return this.transact(() => {
      for (const e of this.openEscalationsFor(orderId)) { e.status = 'escalation_resolved'; e.committedBy = by; e.committedAt = new Date().toISOString(); }
    });
  }

  /** Idempotent: the same (order, amount, reason, policy version) returns the existing open/committed proposal. */
  propose(p: Omit<LedgerEntry, 'proposalId' | 'idempotencyKey' | 'status' | 'createdAt'>): LedgerEntry {
    return this.transact(() => {
      const key = idempotencyKey(p.orderId, p.amountUsd, p.reasonCode, p.policyVersion);
      const existing = this.entries.find((e) => e.idempotencyKey === key && e.status !== 'rejected');
      if (existing) {
        // Same money, newer facts: re-bind the open proposal to the facts it is now being proposed on.
        if (existing.status === 'pending_human' && p.stateVersion && existing.stateVersion !== p.stateVersion) existing.stateVersion = p.stateVersion;
        return { ...existing };
      }
      const e: LedgerEntry = { ...p, proposalId: `prop_${newId()}`, idempotencyKey: key, status: 'pending_human', createdAt: new Date().toISOString() };
      this.entries.push(e);
      return { ...e };
    });
  }
  markCommitted(proposalId: string, by: string) {
    return this.transact(() => { const e = this.get(proposalId)!; e.status = 'committed'; e.committedAt = new Date().toISOString(); e.committedBy = by; return { ...e }; });
  }
  markRejected(proposalId: string, reason: string) {
    return this.transact(() => { const e = this.get(proposalId)!; e.status = 'rejected'; e.rejectedReason = reason; return { ...e }; });
  }
  /** Test/demo helper: seed a committed refund (e.g. for duplicate-claim cases). */
  seedCommitted(e: Pick<LedgerEntry, 'caseId' | 'orderId' | 'amountUsd' | 'reasonCode'>) {
    const p = this.propose({ ...e, policyVersion: 'seed' });
    return this.markCommitted(p.proposalId, 'seed');
  }
  /** Demo helper: forget everything about one order (used when a multi-turn demo scenario restarts). */
  clearOrder(orderId: string) { this.transact(() => { this.entries = this.entries.filter((e) => e.orderId !== orderId); }); }
  reset() { this.transact(() => { this.entries = []; }); }
}
