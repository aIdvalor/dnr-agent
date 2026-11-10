/** Captures UI screenshots into shots/ (and, with MOCKS_DIR, desktop + mobile mocks). Needs the app running (npm run build && npm start).
 *  Uses only replay and scripted models: no API calls. */
import { chromium, type Page } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const MOCKS = process.env.MOCKS_DIR;

const browser = await chromium.launch({ executablePath: exe, headless: true });
const finished = (p: Page) => p.getByText(/Finished ·/).waitFor({ timeout: 30000 });
async function open(width: number, height: number) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/?autoplay=0`);
  await page.getByRole('button', { name: /Refund eligible/ }).waitFor();
  return page;
}
async function runCase(page: Page, label: string, model: string, opts: { fresh?: boolean; again?: boolean } = {}) {
  if (opts.fresh) await fetch(`${BASE}/api/ledger`, { method: 'DELETE' });
  if (!opts.again) await page.getByRole('button', { name: new RegExp(label) }).click();
  if (!opts.again) await page.getByLabel('Model', { exact: true }).selectOption(model);
  await page.getByRole('button', { name: /^(Run agent|Run again|Start over)/ }).click();
  await finished(page);
}
async function save(page: Page, names: string[], full = false) {
  await page.waitForTimeout(500);
  for (const n of names) { fs.mkdirSync(n.split('/').slice(0, -1).join('/'), { recursive: true }); await page.screenshot({ path: n, fullPage: full }); }
}
const out = (n: string, mock?: string) => [`shots/${n}.png`, ...(MOCKS && mock ? [`${MOCKS}/${mock}.png`] : [])];

// 1. Refund eligible (recorded live run) -> human Confirm
let p = await open(1440, 1000);
await runCase(p, 'Refund eligible', 'replay', { fresh: true });
await p.getByRole('button', { name: /Confirm simulated refund/ }).click();
await p.getByText(/written to the case ledger/).waitFor();
await save(p, out('01-refund-eligible-confirmed', '01-desktop-refund-confirmed'));
// 5. Run it again -> duplicate
await runCase(p, 'Refund eligible', 'replay', { again: true });
await save(p, out('05-duplicate-rerun-escalates'));
await p.close();

// 2. Injection, compromised model -> blocked
p = await open(1440, 1000);
await runCase(p, 'Injected carrier note', 'scripted-adversarial');
await save(p, out('02-injection-adversarial-blocked', '02-desktop-injection-blocked'));
await p.close();

// 3/4. Wait for evidence; tool timeout
p = await open(1440, 1000);
await runCase(p, 'Wait for evidence', 'replay');
await save(p, out('03-wait-for-evidence'));
await runCase(p, 'Carrier tool times out', 'replay');
await save(p, out('04-tool-timeout-fails-closed'));
await p.close();

// 7. Timeout then push: escalation sticks (recorded live run)
p = await open(1440, 1000);
await runCase(p, 'Timeout, then the buyer pushes', 'replay');
await p.getByRole('button', { name: 'Send the follow-up' }).click();
await p.waitForTimeout(300); await finished(p);
await save(p, out('07-timeout-then-push-stays-escalated', '03-desktop-escalation-sticks'));
await p.close();

// 6. Mobile: injection blocked; 8. mobile evals
p = await open(390, 844);
await runCase(p, 'Injected carrier note', 'scripted-adversarial');
await p.locator('.outcome').scrollIntoViewIfNeeded();
await save(p, out('06-mobile-injection', '04-mobile-injection-blocked'));
await p.goto(`${BASE}/?autoplay=0#evals`); await p.waitForTimeout(800);
await p.locator('#evals').scrollIntoViewIfNeeded();
await save(p, out('08-mobile-evals', '05-mobile-evals'));
await p.close();

await browser.close();
console.log('shots written');
