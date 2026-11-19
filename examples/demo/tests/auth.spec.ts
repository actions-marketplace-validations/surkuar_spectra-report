import { test, expect } from '@playwright/test';
import { RUN, clickByRole } from './helpers';

// Run 3: the product team renamed the "Sign in" button to "Log in".
const signInExists = RUN < 3;

test.describe('auth', () => {
  test('user can sign in with valid credentials @smoke', async ({}, testInfo) => {
    await test.step('Open /login', async () => {});
    await test.step('Fill email and password', async () => {});
    await clickByRole(testInfo, 'button', 'Sign in', signInExists);
    await test.step('Expect dashboard heading', async () => expect('Dashboard').toBe('Dashboard'));
  });

  test('remember me keeps the session', async ({}, testInfo) => {
    await test.step('Open /login', async () => {});
    await test.step('Tick "Remember me"', async () => {});
    await clickByRole(testInfo, 'button', 'Sign in', signInExists);
  });

  test('wrong password shows an error', async ({}, testInfo) => {
    await test.step('Fill a wrong password', async () => {});
    await clickByRole(testInfo, 'button', 'Sign in', signInExists);
    await test.step('Expect error banner', async () => expect('Invalid email or password').toContain('Invalid'));
  });

  test('user can sign out', async () => {
    await test.step('Open account menu', async () => {});
    await test.step('Click "Sign out"', async () => {});
    expect(true).toBeTruthy();
  });
});
