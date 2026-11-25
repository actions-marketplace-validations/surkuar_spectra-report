import { createHash } from 'node:crypto';
import type { CiInfo, Stats, TestCase } from './types.js';

export const VERSION = '0.1.1';

export function sha1(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex');
}

/** Stable test id from project, file and title path. */
export function testId(project: string | undefined, file: string, titlePath: string[]): string {
  return sha1([project ?? '', file.replace(/\\/g, '/'), ...titlePath].join('␟')).slice(0, 16);
}

// eslint-disable-next-line no-control-regex
const ANSI = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

export function computeStats(tests: TestCase[]): Stats {
  const stats: Stats = { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const t of tests) stats[t.status]++;
  return stats;
}

export function passRate(stats: Stats): number {
  const ran = stats.total - stats.skipped;
  return ran === 0 ? 1 : (stats.passed + stats.flaky) / ran;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** CI metadata from the environment (GitHub Actions today). */
export function detectCi(env: NodeJS.ProcessEnv = process.env): CiInfo | undefined {
  if (env.GITHUB_ACTIONS === 'true') {
    const repo = env.GITHUB_REPOSITORY;
    const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
    const prMatch = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '');
    return {
      provider: 'github',
      repo,
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
      baseBranch: env.GITHUB_BASE_REF || undefined,
      commit: env.GITHUB_SHA,
      pr: prMatch ? Number(prMatch[1]) : undefined,
      runUrl: repo && env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined,
      runNumber: env.GITHUB_RUN_NUMBER,
      actor: env.GITHUB_ACTOR,
    };
  }
  if (env.CI) return { provider: 'ci', branch: env.BRANCH_NAME || env.CI_COMMIT_REF_NAME, commit: env.GIT_COMMIT || env.CI_COMMIT_SHA };
  return undefined;
}

export function runIdFromEnv(env: NodeJS.ProcessEnv = process.env, startedAt = new Date()): string {
  if (env.GITHUB_RUN_ID) return `gh-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  return `local-${startedAt.toISOString().replace(/[:.]/g, '-')}`;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…';
}
