import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clusterFailures, errorSignature, extractLocator, normalizeLine } from '../src/cluster.js';
import { flakeRate, annotateWithHistory, emptyHistory, nextHistory } from '../src/history.js';
import { redact } from '../src/redact.js';
import { importJUnit, parseXml } from '../src/importers/junit.js';
import { buildPrompt, explainClusters, parseInsight, type AiOptions, type FetchLike } from '../src/ai.js';
import { renderSummary, COMMENT_MARKER } from '../src/summary.js';
import { generate, safeJson } from '../src/generate.js';
import type { HistoryEntry, RawRun, Status, TestCase } from '../src/types.js';

function tc(id: string, status: Status, message?: string, extra: Partial<TestCase> = {}): TestCase {
  return {
    id,
    title: `test ${id}`,
    titlePath: ['suite', `test ${id}`],
    file: 'tests/a.spec.ts',
    project: 'chromium',
    tags: [],
    annotations: [],
    status,
    durationMs: 100,
    attempts: [{ retry: 0, status: status === 'failed' ? 'failed' : 'passed', durationMs: 100, errors: message ? [{ message }] : [], steps: [], attachments: [], stdout: [], stderr: [] }],
    ...extra,
  };
}

const hist = (...s: Status[]): HistoryEntry[] => s.map((status, i) => ({ runId: `r${i}`, at: new Date(2026, 0, i + 1).toISOString(), status, durationMs: 1 }));

test('normalizeLine masks numbers, ids and long strings', () => {
  assert.equal(normalizeLine('Timeout 5000ms exceeded for order 3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90'), 'Timeout <N>ms exceeded for order <ID>');
  assert.equal(normalizeLine('Expected "a very long product description that changes each run!!"'), 'Expected "<STR>"');
  assert.equal(normalizeLine('GET https://x.io/api/items?page=2 failed'), 'GET https://x.io/api/items failed');
});

test('extractLocator finds Playwright locators', () => {
  assert.equal(extractLocator("Locator: getByRole('button', { name: 'Save' })\nExpected: visible"), "getByRole('button', { name: 'Save' })");
  assert.equal(extractLocator("locator.click: Timeout 5000ms exceeded.\n  - waiting for locator('#login')"), "locator('#login')");
});

test('same cause with different timeouts groups together; different locators do not', () => {
  const a = "locator.click: Timeout 5000ms exceeded.\n  - waiting for locator('#login')";
  const b = "locator.click: Timeout 7500ms exceeded.\n  - waiting for locator('#login')";
  const c = "locator.click: Timeout 5000ms exceeded.\n  - waiting for locator('#logout')";
  assert.equal(errorSignature({ message: a }), errorSignature({ message: b }));
  assert.notEqual(errorSignature({ message: a }), errorSignature({ message: c }));
  const tests = [tc('1', 'failed', a), tc('2', 'failed', b), tc('3', 'failed', c), tc('4', 'passed')];
  const clusters = clusterFailures(tests);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].testIds.length, 2);
  assert.equal(tests[0].clusterId, clusters[0].id);
  assert.equal(tests[3].clusterId, undefined);
});

test('flakeRate: retries and blips count, a lasting break does not', () => {
  assert.equal(flakeRate(hist('passed', 'passed', 'passed'), 'passed'), 0);
  assert.equal(flakeRate(hist('passed', 'passed', 'passed'), 'failed'), 0);
  assert.equal(flakeRate(hist('passed', 'failed', 'failed'), 'failed'), 0);
  assert.equal(flakeRate(hist('passed', 'flaky', 'passed'), 'flaky'), 0.5);
  assert.equal(flakeRate(hist('passed', 'failed', 'passed'), 'passed'), 0.25);
  assert.equal(flakeRate([], 'passed'), 0);
});

test('annotateWithHistory flags new failures only when the last run was not failing', () => {
  const h = emptyHistory();
  h.tests['a'] = hist('passed', 'passed');
  h.tests['b'] = hist('failed', 'failed');
  h.tests['c'] = hist('failed', 'skipped');
  const tests = [tc('a', 'failed', 'x'), tc('b', 'failed', 'x'), tc('c', 'failed', 'x'), tc('d', 'failed', 'x')];
  annotateWithHistory(tests, h);
  assert.deepEqual(tests.map((t) => t.isNewFailure), [true, false, false, true]);
});

test('nextHistory appends, dedupes by run id and caps length', () => {
  const h = emptyHistory();
  h.tests['a'] = hist(...Array<Status>(60).fill('passed'));
  const report = { run: { id: 'now', startedAt: new Date().toISOString(), durationMs: 5 }, stats: { total: 1, passed: 0, failed: 1, flaky: 0, skipped: 0 }, tests: [tc('a', 'failed', 'x')] } as any;
  const n1 = nextHistory(h, report);
  const n2 = nextHistory(n1, report);
  assert.equal(n2.tests['a'].length, 50);
  assert.equal(n2.tests['a'].at(-1)!.status, 'failed');
  assert.equal(n2.runs.filter((r) => r.runId === 'now').length, 1);
});

test('redact masks common secrets', () => {
  const input = [
    'Authorization: Bearer abcdefghijklmnop123',
    'token sk-ant-api03-abcdefghijklmnopqrstuv',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'https://admin:hunter2@staging.example.com/login',
    'password=SuperSecret123&user=bob',
    'contact jane.doe@example.com',
    'AKIAABCDEFGHIJKLMNOP',
  ].join('\n');
  const out = redact(input);
  for (const leaked of ['abcdefghijklmnop123', 'sk-ant-api03', 'ghp_abc', 'hunter2', 'SuperSecret123', 'jane.doe@example.com', 'AKIAABCDEFGHIJKLMNOP']) {
    assert.ok(!out.includes(leaked), `leaked ${leaked}: ${out}`);
  }
  assert.ok(out.includes('staging.example.com/login'));
});

test('JUnit import maps passed, failed, skipped and flaky', () => {
  const xml = `<?xml version="1.0"?>
  <testsuites><testsuite name="LoginTests" tests="4">
    <testcase classname="com.acme.LoginTests" name="valid login" time="1.5"/>
    <testcase classname="com.acme.LoginTests" name="bad password &amp; lockout" time="0.2">
      <failure message="expected &lt;true&gt; but was &lt;false&gt;" type="AssertionError"><![CDATA[at com.acme.LoginTests.bad(LoginTests.java:42)]]></failure>
    </testcase>
    <testcase classname="com.acme.LoginTests" name="sso" time="0"><skipped message="not on staging"/></testcase>
    <testcase classname="com.acme.LoginTests" name="remember me" time="2"><flakyFailure message="timeout" type="TimeoutException"/></testcase>
  </testsuite></testsuites>`;
  const run = importJUnit(xml);
  assert.deepEqual(run.tests.map((t) => t.status), ['passed', 'failed', 'skipped', 'flaky']);
  assert.equal(run.tests[1].title, 'bad password & lockout');
  assert.match(run.tests[1].attempts[0].errors[0].message, /AssertionError: expected <true> but was <false>/);
  assert.equal(run.tests[0].durationMs, 1500);
  assert.equal(run.tests[3].attempts.length, 2);
  assert.equal(parseXml('<a x="1"><b/>t</a>').children[0].attrs.x, '1');
});

const aiOpts: AiOptions = { provider: 'anthropic', apiKey: 'k', model: 'test-model', maxClusters: 2, maxChars: 4000, timeoutMs: 2000 };

test('parseInsight accepts JSON wrapped in prose and clamps values', () => {
  const i = parseInsight('Here you go:\n```json\n{"summary":"Login button missing","likelyCause":"Renamed","suggestedFix":"Update locator","category":"locator","confidence":1.7}\n```');
  assert.equal(i.category, 'locator');
  assert.equal(i.confidence, 1);
  assert.throws(() => parseInsight('no json here'));
  assert.equal(parseInsight('{"summary":"x","likelyCause":"y","category":"weird","confidence":"0.4"}').category, 'unknown');
});

test('buildPrompt is redacted and bounded', () => {
  const t = tc('1', 'failed', 'Error at https://u:pw123@host/x with Bearer abcdefghijklmnopqrstu');
  const [c] = clusterFailures([t]);
  const p = buildPrompt(c, [t], 300);
  assert.ok(p.length <= 300);
  assert.ok(!p.includes('pw123'));
  assert.ok(!p.includes('abcdefghijklmnopqrstu'));
});

test('explainClusters calls once per group, caches, caps calls and never throws', async () => {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (calls.length === 2) return { ok: false, status: 529, text: async () => 'overloaded' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"summary":"S","likelyCause":"C","suggestedFix":"F","category":"timing","confidence":0.6}' }] }) };
  };
  const tests = ['a', 'b', 'c', 'd'].map((x) => tc(x, 'failed', `boom ${x}x`.replace(/\d/g, '') + x.repeat(3)));
  const clusters = clusterFailures(tests);
  assert.equal(clusters.length, 4);
  const cache: Record<string, any> = {};
  const r = await explainClusters(clusters, new Map(tests.map((t) => [t.id, t])), aiOpts, cache, fetchImpl);
  assert.equal(r.calls, 2);
  assert.equal(r.errors, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].headers['x-api-key'], 'k');
  assert.equal(calls[0].body.model, 'test-model');
  assert.equal(clusters[0].ai?.category, 'timing');
  assert.match(clusters[1].aiError ?? '', /529/);
  assert.equal(clusters[2].ai, undefined);
  // second run: first cluster comes from cache, no call for it
  calls.length = 0;
  for (const c of clusters) { delete c.ai; delete c.aiError; }
  const r2 = await explainClusters(clusters, new Map(tests.map((t) => [t.id, t])), { ...aiOpts, maxClusters: 0 }, cache, fetchImpl);
  assert.equal(r2.cacheHits, 1);
  assert.equal(calls.length, 0);
  assert.equal(clusters[0].ai?.cached, true);
});

test('OpenAI-compatible provider uses chat completions', async () => {
  let seen = '';
  const fetchImpl: FetchLike = async (url, init) => {
    seen = url + ' ' + init.headers.authorization;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"summary":"S","likelyCause":"C","suggestedFix":"F","category":"locator","confidence":0.5}' } }] }) };
  };
  const tests = [tc('a', 'failed', 'x')];
  const clusters = clusterFailures(tests);
  await explainClusters(clusters, new Map([[tests[0].id, tests[0]]]), { ...aiOpts, provider: 'openai', baseUrl: 'http://localhost:11434/v1/' }, {}, fetchImpl);
  assert.equal(seen, 'http://localhost:11434/v1/chat/completions Bearer k');
  assert.equal(clusters[0].ai?.category, 'locator');
});

test('summary has the sticky marker, new failures and escapes pipes', () => {
  const t = tc('a', 'failed', 'x', { isNewFailure: true, titlePath: ['a | b', 'c'] });
  const report: any = { run: { id: 'r', startedAt: '', durationMs: 65000, ci: { commit: 'abcdef1234' } }, stats: { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0 }, tests: [t, tc('b', 'passed')], clusters: clusterFailures([t]), reportUrl: 'https://u.github.io/r/main/1/' };
  const md = renderSummary(report);
  assert.ok(md.startsWith(COMMENT_MARKER));
  assert.match(md, /1 passed, 1 failed/);
  assert.match(md, /New failures \(1\)/);
  assert.match(md, /a \\\| b/);
  assert.match(md, /https:\/\/u\.github\.io\/r\/main\/1\/#\/test\/a/);
  assert.match(md, /1m 5s/);
});

test('safeJson cannot break out of a script context', () => {
  const s = safeJson({ m: '</script><script>alert(1)</script> ' });
  assert.ok(!s.includes('</script>'));
  assert.ok(!s.includes(' '));
  assert.deepEqual(JSON.parse(s), { m: '</script><script>alert(1)</script> ' });
});

test('generate merges shards, copies attachments and writes history', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-'));
  const mk = (name: string, tests: TestCase[]) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'attachments', `${name}.png`), 'png');
    const raw: RawRun = { schemaVersion: 1, run: { id: 'run-1', startedAt: new Date().toISOString(), durationMs: 1000, framework: 'playwright' }, tests };
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(raw));
    return dir;
  };
  const withAtt = tc('x', 'failed', 'boom');
  withAtt.attempts[0].attachments.push({ name: 'screenshot', contentType: 'image/png', path: 'attachments/s1.png' });
  const d1 = mk('s1', [withAtt]);
  const d2 = mk('s2', [tc('y', 'passed')]);
  const out = path.join(tmp, 'report');
  const { report } = await generate({ resultsDirs: [d1, d2], outDir: out, ai: false, log: () => {} });
  assert.equal(report.stats.total, 2);
  assert.equal(report.clusters.length, 1);
  assert.equal(report.tests[0].attempts[0].attachments[0].path, 'data/attachments/s1.png');
  for (const f of ['index.html', 'data/report.js', 'data/report.json', 'data/attachments/s1.png', 'data/attachments/s2.png', 'summary.md', 'history.json']) {
    assert.ok(fs.existsSync(path.join(out, f)), `missing ${f}`);
  }
  const h = JSON.parse(fs.readFileSync(path.join(out, 'history.json'), 'utf8'));
  assert.equal(h.tests['x'][0].status, 'failed');
});
