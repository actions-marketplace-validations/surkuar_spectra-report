/** Deterministic failure grouping: no AI needed, always on. */
import type { Cluster, ErrorInfo, TestCase } from './types.js';
/** Replace volatile parts of an error line so equal causes compare equal. */
export declare function normalizeLine(line: string): string;
/** Pull the locator a Playwright error talks about, if any. */
export declare function extractLocator(message: string): string | undefined;
export declare function primaryError(test: TestCase): ErrorInfo | undefined;
export declare function errorSignature(err: ErrorInfo): string;
export declare function humanTitle(err: ErrorInfo): string;
/** Group failed tests by signature; ranked by tests affected, then new failures. */
export declare function clusterFailures(tests: TestCase[]): Cluster[];
