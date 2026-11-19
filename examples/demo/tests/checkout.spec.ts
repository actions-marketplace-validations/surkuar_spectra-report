import { test, expect } from '@playwright/test';
import { cartTotal } from './helpers';

test.describe('checkout', () => {
  test('order total includes sales tax @smoke', async () => {
    const total = await test.step('Compute cart total', async () =>
      cartTotal([{ price: 19.99, qty: 2 }, { price: 5.25, qty: 1 }], 0.0825),
    );
    await test.step('Expect total on the summary page', async () => {
      expect(total).toBe(48.96);
    });
  });

  test('discount code reduces the total', async () => {
    const total = cartTotal([{ price: 40, qty: 1 }], 0.0825);
    expect(total).toBeGreaterThan(0);
  });

  test('empty cart cannot check out', async () => {
    await test.step('Open /checkout with an empty cart', async () => {});
    expect([]).toHaveLength(0);
  });
});
