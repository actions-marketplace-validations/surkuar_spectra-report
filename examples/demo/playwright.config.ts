import { defineConfig } from '@playwright/test';

/**
 * Demo suite used to test Spectra Report end to end. The tests need no browser,
 * so they run anywhere; DEMO_RUN=1..3 simulates three CI runs with different failures.
 */
export default defineConfig({
  testDir: './tests',
  retries: 1,
  reporter: [['list'], [process.env.SPECTRA_REPORTER ?? 'spectra-report/playwright', { outputDir: process.env.SPECTRA_RESULTS_DIR ?? 'spectra-results', runName: 'Acme Shop e2e' }]],
  projects: [{ name: 'chromium' }, { name: 'firefox' }],
});
