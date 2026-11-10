/**
 * EVAL-ONLY ablation switch: turns off the three deterministic guards (propose_refund recheck,
 * post-loop reconciliation + reply guard, commit-time recheck) so the eval can show what the
 * same misbehaving model would do without them. Refuses to turn on inside the Next.js app.
 */
export function guardsDisabled(): boolean {
  if (process.env.DNR_ABLATION_NO_GUARDS !== '1') return false;
  if (process.env.NEXT_RUNTIME) throw new Error('DNR_ABLATION_NO_GUARDS is eval-only and cannot run inside the app');
  return true;
}

/** EVAL-ONLY: turn off the instruction-like-text tripwire, to show money safety does not depend on detection. */
export function tripwireDisabled(): boolean {
  if (process.env.DNR_ABLATION_NO_TRIPWIRE !== '1') return false;
  if (process.env.NEXT_RUNTIME) throw new Error('DNR_ABLATION_NO_TRIPWIRE is eval-only and cannot run inside the app');
  return true;
}
