import fs from 'node:fs';
import type { HistoryEntry, HistoryFile, Report, Status, TestCase } from './types.js';

export function emptyHistory(): HistoryFile {
  return { version: 1, runs: [], tests: {}, aiCache: {} };
}

export function loadHistory(file?: string): HistoryFile {
  if (!file || !fs.existsSync(file)) return emptyHistory();
  try {
    const h = JSON.parse(fs.readFileSync(file, 'utf8')) as HistoryFile;
    if (h.version !== 1) return emptyHistory();
    return { version: 1, runs: h.runs ?? [], tests: h.tests ?? {}, aiCache: h.aiCache ?? {} };
  } catch {
    return emptyHistory();
  }
}

/**
 * Share of recent runs (this one included) that look flaky: the test passed only
 * on retry, or failed once between two passing runs (a "blip").
 * A test that breaks and stays broken is a real failure, not flakiness.
 * 0 = stable, 1 = unstable every run.
 */
export function flakeRate(previous: HistoryEntry[], current: Status, window = 20): number {
  const seq = [...previous.map((h) => h.status), current].filter((s) => s !== 'skipped').slice(-window);
  if (seq.length === 0) return 0;
  let unstable = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === 'flaky') unstable++;
    else if (seq[i] === 'failed' && i > 0 && i < seq.length - 1 && seq[i - 1] !== 'failed' && seq[i + 1] !== 'failed') unstable++;
  }
  return Math.round((unstable / seq.length) * 100) / 100;
}

/** Attach history, flake rate and new-failure flags to this run's tests. */
export function annotateWithHistory(tests: TestCase[], history: HistoryFile): void {
  for (const t of tests) {
    const prev = history.tests[t.id] ?? [];
    t.history = prev.slice(-20);
    t.flakeRate = flakeRate(prev, t.status);
    const last = [...prev].reverse().find((h) => h.status !== 'skipped');
    t.isNewFailure = t.status === 'failed' && (!last || last.status !== 'failed');
  }
}

/** History to persist after this run. */
export function nextHistory(history: HistoryFile, report: Report, maxPerTest = 50, maxRuns = 100): HistoryFile {
  const tests: Record<string, HistoryEntry[]> = { ...history.tests };
  for (const t of report.tests) {
    const entry: HistoryEntry = { runId: report.run.id, at: report.run.startedAt, status: t.status, durationMs: t.durationMs };
    tests[t.id] = [...(tests[t.id] ?? []).filter((e) => e.runId !== report.run.id), entry].slice(-maxPerTest);
  }
  const runs = [
    ...history.runs.filter((r) => r.runId !== report.run.id),
    { runId: report.run.id, at: report.run.startedAt, stats: report.stats, durationMs: report.run.durationMs },
  ].slice(-maxRuns);
  // Keep the AI cache bounded: newest 300 signatures.
  const cacheEntries = Object.entries(history.aiCache);
  const aiCache = Object.fromEntries(cacheEntries.slice(-300));
  return { version: 1, runs, tests, aiCache };
}
