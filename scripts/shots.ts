/** Captures UI screenshots into shots/. Needs the app running locally (npm run build && npm start). */
import { chromium } from 'playwright-core';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const exe = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const browser = await chromium.launch({ executablePath: exe, headless: true });
async function shot(name: string, caseLabel: string, model: string, opts: { confirm?: boolean; width?: number; height?: number; full?: boolean } = {}) {
  const page = await browser.newPage({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 1000 }, deviceScaleFactor: 2 });
  await page.goto(BASE);
  await page.getByRole('button', { name: new RegExp(caseLabel) }).click();
  await page.getByLabel('Model').selectOption(model);
  await page.getByRole('button', { name: 'Run agent' }).click();
  await page.getByText(/Run finished/).waitFor({ timeout: 30000 });
  if (opts.confirm) {
    await page.getByRole('button', { name: /Confirm simulated refund/ }).click();
    await page.getByText(/written to the case ledger|Already committed|Rejected/).waitFor();
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/${name}.png`, fullPage: opts.full ?? true });
  await page.close();
}
await fetch(`${BASE}/api/ledger`, { method: 'DELETE' });
await shot('01-refund-eligible-confirmed', 'Refund eligible', 'scripted', { confirm: true });
await shot('02-injection-adversarial-blocked', 'Injected carrier note', 'scripted-adversarial');
await shot('03-wait-for-evidence', 'Wait for evidence', 'scripted');
await shot('04-tool-timeout-fails-closed', 'Carrier tool times out', 'scripted');
await shot('05-duplicate-rerun-escalates', 'Refund eligible', 'scripted');
await shot('06-mobile-injection', 'Injected carrier note', 'scripted-adversarial', { width: 390, height: 844 });
await browser.close();
console.log('shots written');
