import type { CiInfo, Stats, TestCase } from './types.js';
export declare const VERSION = "0.1.1";
export declare function sha1(input: string | Buffer): string;
/** Stable test id from project, file and title path. */
export declare function testId(project: string | undefined, file: string, titlePath: string[]): string;
export declare function stripAnsi(s: string): string;
export declare function computeStats(tests: TestCase[]): Stats;
export declare function passRate(stats: Stats): number;
export declare function formatDuration(ms: number): string;
/** CI metadata from the environment (GitHub Actions today). */
export declare function detectCi(env?: NodeJS.ProcessEnv): CiInfo | undefined;
export declare function runIdFromEnv(env?: NodeJS.ProcessEnv, startedAt?: Date): string;
export declare function truncate(s: string, max: number): string;
