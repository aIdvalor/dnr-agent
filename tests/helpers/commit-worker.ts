/** Child process for the cross-process concurrency test: waits for a start time, then confirms one proposal. */
import { Ledger } from '../../lib/ledger';
import { commitRefund } from '../../lib/commit';
import { w, claim } from '../fixtures';
const [file, proposalId, stateVersion, startAt] = process.argv.slice(2);
while (Date.now() < Number(startAt)) { /* spin to line up all workers */ }
const r = commitRefund({ approval: { proposalId, stateVersion }, world: w(), claim: claim(), ledger: new Ledger(file), by: 'human:worker' });
process.stdout.write(JSON.stringify({ proposalId, status: r.status, reason: (r as any).reason ?? null }));
