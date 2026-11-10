/**
 * Smoke test for the static demo (local export or the deployed Pages URL). Clicks through the main scenarios,
 * records every network request and fails if any leaves the site's origin (no model or AI-provider calls).
 * Saves desktop + mobile screenshots. Usage: BASE_URL=https://<user>.github.io/dnr-agent/ SHOTS_DIR=/tmp/s npx tsx scripts/smoke-static.ts
 */
import { chromium, type Page } from 'playwright-core';
import fs from 'node:fs';
const BASE = (process.env.BASE_URL ?? 'http://localhost:8765/dnr-agent/').replace(/\/?$/, '/');
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/dnr-smoke';
fs.mkdirSync(SHOTS, { recursive: true });
const origin = new URL(BASE).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true });
const offOrigin: string[] = []; const failed: string[] = []; const errors: string[] = [];
const checks: [string, boolean][] = [];
const ok = (name: string, v: boolean) => { checks.push([name, v]); };

async function page(width: number, height: number, mobile = false) {
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  p.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) offOrigin.push(r.url()); });
  p.on('requestfailed', (r) => failed.push(r.url()));
  p.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${BASE}?autoplay=0`);
  await p.getByRole('button', { name: /Refund eligible/ }).waitFor({ timeout: 20000 });
  return p;
}
const finished = (p: Page) => p.getByText(/Finished ·/).first().waitFor({ timeout: 30000 });
async function runCase(p: Page, label: string, model: string) {
  await p.getByRole('button', { name: new RegExp(label) }).first().click();
  await p.getByLabel('Model', { exact: true }).selectOption(model);
  await p.getByRole('button', { name: /^(Run agent|Run again|Start over)/ }).click();
  await finished(p);
}

const d = await page(1440, 1000);
await runCase(d, 'Refund eligible', 'replay');
ok('n01 replay: refund eligible headline', await d.getByText(/Refund eligible: \$42\.00 waits/).isVisible());
await d.getByRole('button', { name: /Confirm simulated refund/ }).click();
await d.getByText(/written to the case ledger/).waitFor();
ok('n01 confirm commits once', (await d.locator('li.le.committed').count()) === 1);
await d.screenshot({ path: `${SHOTS}/desktop-n01-confirmed.png` });
await d.getByRole('button', { name: /^Run again/ }).click(); await finished(d);
ok('n01 re-run after commit escalates as duplicate', await d.getByText(/Already refunded once/).isVisible());
await runCase(d, 'Injected carrier note', 'scripted-adversarial');
ok('i01 adversarial: injected $500 blocked', await d.getByText(/blocked and never reached the ledger/).isVisible());
await d.screenshot({ path: `${SHOTS}/desktop-i01-blocked.png` });
await runCase(d, 'Timeout, then the buyer pushes', 'replay');
await d.getByRole('button', { name: /Send the follow-up/ }).click(); await d.waitForTimeout(300); await finished(d);
ok('t03 replay turn 2 stays with a human', await d.getByText(/Still with a human/).isVisible());
await d.screenshot({ path: `${SHOTS}/desktop-t03-turn2.png` });
await d.locator('#evals').scrollIntoViewIfNeeded();
ok('evals view renders numbers', !(await d.getByText('Loading eval results…').isVisible()));
await d.screenshot({ path: `${SHOTS}/desktop-full.png`, fullPage: true });

const m = await page(390, 844, true);
await runCase(m, 'Injected carrier note', 'replay');
await m.screenshot({ path: `${SHOTS}/mobile-i01.png`, fullPage: true });
ok('mobile run finished', true);

await browser.close();
for (const [n, v] of checks) console.log(`${v ? 'ok  ' : 'FAIL'} ${n}`);
console.log(`requests off ${origin}: ${offOrigin.length}${offOrigin.length ? ' -> ' + [...new Set(offOrigin)].join(', ') : ''}`);
console.log(`failed/4xx requests: ${failed.length}${failed.length ? ' -> ' + failed.slice(0, 5).join(', ') : ''}`);
console.log(`page errors: ${errors.length}${errors.length ? ' -> ' + errors.slice(0, 3).join(' | ') : ''}`);
console.log(`screenshots: ${SHOTS}`);
process.exit(checks.every(([, v]) => v) && !offOrigin.length && !errors.length ? 0 : 1);
