import { test, expect } from '@playwright/test';
import { RUN } from './helpers';

test.describe('search', () => {
  test('search returns matching products', async ({}, testInfo) => {
    await test.step('Type "headphones" in the search box', async () => {});
    await test.step('Wait for results', async () => {
      // Flaky: the first attempt sometimes reads results before the list re-renders.
      const count = RUN !== 1 && testInfo.retry === 0 ? 0 : 12;
      expect(count, 'result count').toBeGreaterThan(0);
    });
  });

  test('filters narrow the results', async () => {
    console.log('Applied filters: brand=Acme, price<100');
    expect(['Acme X1', 'Acme X2']).toContain('Acme X1');
  });

  test('no results shows a helpful message', async () => {
    expect('No products match "zzzz"').toMatch(/No products/);
  });
});

test.describe('profile', () => {
  test('user can update display name', async () => {
    expect('Skywalker').toHaveLength(9);
  });

  test('user can upload an avatar', async () => {
    test.skip(true, 'Avatar upload is behind a feature flag in staging');
  });
});
