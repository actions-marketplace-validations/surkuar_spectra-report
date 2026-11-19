// Runs the demo Playwright suite six times (simulating six CI runs) and builds
// a report with real history: `npm run demo` -> demo-report/index.html
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root, 'examples', 'demo');
const work = path.join(root, '.demo-work');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const out = path.resolve(outArg ?? path.join(root, 'demo-report'));
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const sequence = [1, 1, 1, 2, 2, 3]; // 1 = healthy, 2 = checkout bug, 3 = checkout bug + renamed login button
// --mock-ai: serve canned "AI" answers from a local Anthropic-compatible endpoint,
// so the demo shows AI hints without an API key. Labelled as sample output.
let mock;
const aiEnv = {};
if (process.argv.includes('--mock-ai')) {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const prompt = JSON.parse(body).messages[0].content;
      const answer = prompt.includes('Sign in')
        ? {
            summary: "The 'Sign in' button can no longer be found on the login page, in both browsers.",
            likelyCause: "All affected tests time out on the same getByRole('button', { name: 'Sign in' }) locator and passed in the previous run, which points to a renamed or removed button rather than slowness.",
            suggestedFix: "Check the login page's current button text. If it was renamed, update the locator once in the shared login helper, e.g. getByRole('button', { name: /sign in|log in/i }), or ask the team for a stable data-testid.",
            category: 'locator',
            confidence: 0.82,
          }
        : {
            summary: 'The order total no longer matches the expected value of 48.96.',
            likelyCause: 'Both browsers get the same wrong total, and it has failed on every run since it first broke, so this looks like a real change in total calculation (rounding or tax order), not a flaky test.',
            suggestedFix: 'Diff the cart-total code from the first failing run. Check that tax is rounded to cents rather than truncated. If the new total is intended, update the expected value in checkout.spec.ts.',
            category: 'product-bug',
            confidence: 0.67,
          };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }] }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  Object.assign(aiEnv, { SPECTRA_AI_PROVIDER: 'anthropic', SPECTRA_AI_API_KEY: 'demo', SPECTRA_AI_MODEL: 'sample AI output (demo)', SPECTRA_AI_BASE_URL: `http://127.0.0.1:${mock.address().port}` });
}
let history;
for (const [i, demoRun] of sequence.entries()) {
  const results = path.join(work, `results-${i}`);
  const env = {
    ...process.env,
    DEMO_RUN: String(demoRun),
    SPECTRA_RESULTS_DIR: results,
    SPECTRA_REPORTER: path.join(root, 'dist', 'src', 'playwright.js'),
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'surkuar/spectra-demo',
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: (0xa1b2c3d0 + i).toString(16) + '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
    GITHUB_RUN_ID: String(9100 + i),
    GITHUB_RUN_NUMBER: String(140 + i),
    GITHUB_SERVER_URL: 'https://github.com',
    CI: '1',
  };
  try {
    await run('npx', ['playwright', 'test', '--reporter', `${env.SPECTRA_REPORTER}`], { cwd: demo, env });
  } catch {
    /* failing tests exit non-zero; that's the point */
  }
  const isLast = i === sequence.length - 1;
  const dir = isLast ? out : path.join(work, `report-${i}`);
  const args = [path.join(root, 'dist', 'src', 'cli.js'), 'generate', '-r', results, '-o', dir, '--name', 'Acme Shop e2e'];
  if (history) args.push('--history', history);
  const r = await run(process.execPath, args, { env: { ...env, ...aiEnv, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '' } });
  process.stderr.write(r.stderr);
  history = path.join(dir, 'history.json');
}
mock?.close();
console.log(`\nDemo report: ${path.join(out, 'index.html')}`);
