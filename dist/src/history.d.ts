import type { HistoryEntry, HistoryFile, Report, Status, TestCase } from './types.js';
export declare function emptyHistory(): HistoryFile;
export declare function loadHistory(file?: string): HistoryFile;
/**
 * Share of recent runs (this one included) that look flaky: the test passed only
 * on retry, or failed once between two passing runs (a "blip").
 * A test that breaks and stays broken is a real failure, not flakiness.
 * 0 = stable, 1 = unstable every run.
 */
export declare function flakeRate(previous: HistoryEntry[], current: Status, window?: number): number;
/** Attach history, flake rate and new-failure flags to this run's tests. */
export declare function annotateWithHistory(tests: TestCase[], history: HistoryFile): void;
/** History to persist after this run. */
export declare function nextHistory(history: HistoryFile, report: Report, maxPerTest?: number, maxRuns?: number): HistoryFile;
