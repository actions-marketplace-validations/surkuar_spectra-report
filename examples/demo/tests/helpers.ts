import path from 'node:path';
import { test, type TestInfo } from '@playwright/test';

export const RUN = Number(process.env.DEMO_RUN ?? 3);
const SHOT = path.join(__dirname, '..', 'fixtures', 'login-page.png');

/** Simulates Playwright's locator timeout error, as a real page would throw it. */
export async function clickByRole(testInfo: TestInfo, role: string, name: string, exists: boolean) {
  await test.step(`getByRole('${role}', { name: '${name}' }).click()`, async () => {
    if (exists) return;
    await testInfo.attach('screenshot', { path: SHOT, contentType: 'image/png' });
    const err = new Error(
      `locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('${role}', { name: '${name}' })\n`,
    );
    err.name = 'TimeoutError';
    throw err;
  });
}

export function cartTotal(items: { price: number; qty: number }[], taxRate: number): number {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  // Run 2+ ships a rounding bug: tax applied before discounts and truncated.
  if (RUN >= 2) return Math.floor(subtotal * (1 + taxRate) * 10) / 10;
  return Math.round(subtotal * (1 + taxRate) * 100) / 100;
}
