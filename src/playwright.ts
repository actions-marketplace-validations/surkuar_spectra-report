/**
 * Spectra Report — Playwright reporter.
 *
 *   // playwright.config.ts
 *   reporter: [['list'], ['spectra-report/playwright', { outputDir: 'spectra-results' }]]
 *
 * Writes `<outputDir>/run.json` plus `<outputDir>/attachments/*`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase as PwTestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import type { Attachment, Attempt, ErrorInfo, RawRun, Status, Step, TestCase } from './types.js';
import { detectCi, runIdFromEnv, sha1, stripAnsi, testId } from './util.js';

export interface SpectraReporterOptions {
  /** Folder for run.json and attachments. Default: `spectra-results` (or $SPECTRA_RESULTS_DIR). */
  outputDir?: string;
  /** Optional run name shown in the report header. */
  runName?: string;
  /** Text attachments up to this size are inlined into run.json. Default 16 KB. */
  inlineTextLimit?: number;
}

const EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/webm': '.webm',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'application/json': '.json',
  'text/html': '.html',
};

class SpectraReporter implements Reporter {
  private readonly outDir: string;
  private readonly runName?: string;
  private readonly inlineTextLimit: number;
  private config!: FullConfig;
  private suite!: Suite;
  private startedAt = new Date();

  constructor(options: SpectraReporterOptions = {}) {
    this.outDir = path.resolve(options.outputDir ?? process.env.SPECTRA_RESULTS_DIR ?? 'spectra-results');
    this.runName = options.runName ?? process.env.SPECTRA_RUN_NAME;
    this.inlineTextLimit = options.inlineTextLimit ?? 16 * 1024;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.startedAt = new Date();
    fs.rmSync(this.outDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(this.outDir, 'attachments'), { recursive: true });
  }

  async onEnd(result: FullResult): Promise<void> {
    const tests = this.suite.allTests().map((t) => this.convertTest(t));
    const raw: RawRun = {
      schemaVersion: 1,
      run: {
        id: runIdFromEnv(process.env, this.startedAt),
        name: this.runName,
        startedAt: this.startedAt.toISOString(),
        durationMs: Math.round(result.duration ?? Date.now() - this.startedAt.getTime()),
        framework: 'playwright',
        frameworkVersion: this.config.version,
        ci: detectCi(),
      },
      tests,
    };
    fs.writeFileSync(path.join(this.outDir, 'run.json'), JSON.stringify(raw, null, 2));
  }

  private convertTest(test: PwTestCase): TestCase {
    const rootDir = this.config.rootDir;
    const file = path.relative(rootDir, test.location.file).replace(/\\/g, '/');
    // titlePath(): ['', projectName, file, ...describes, title]
    const titlePath = test.titlePath().slice(3);
    const project = test.parent.project()?.name || undefined;
    const attempts = test.results.map((r) => this.convertResult(r));
    return {
      id: testId(project, file, titlePath),
      title: test.title,
      titlePath,
      file,
      line: test.location.line,
      project,
      tags: (test as { tags?: string[] }).tags ?? [],
      annotations: test.annotations.map((a) => ({ type: a.type, description: a.description })),
      status: mapOutcome(test),
      durationMs: attempts.reduce((sum, a) => sum + a.durationMs, 0),
      attempts,
    };
  }

  private convertResult(r: TestResult): Attempt {
    const errors: ErrorInfo[] = (r.errors ?? []).map((e) => ({
      message: stripAnsi(e.message ?? e.value ?? 'Unknown error'),
      stack: e.stack ? stripAnsi(e.stack) : undefined,
      snippet: e.snippet ? stripAnsi(e.snippet) : undefined,
      location: e.location
        ? { file: path.relative(this.config.rootDir, e.location.file).replace(/\\/g, '/'), line: e.location.line, column: e.location.column }
        : undefined,
    }));
    return {
      retry: r.retry,
      status: r.status,
      durationMs: r.duration,
      startedAt: r.startTime?.toISOString(),
      errors,
      steps: r.steps.map(convertStep),
      attachments: r.attachments.map((a) => this.saveAttachment(a)).filter((a): a is Attachment => !!a),
      stdout: r.stdout.map(chunkToString),
      stderr: r.stderr.map(chunkToString),
    };
  }

  private saveAttachment(a: TestResult['attachments'][number]): Attachment | undefined {
    try {
      const isText = a.contentType.startsWith('text/') || a.contentType === 'application/json';
      if (a.body) {
        if (isText && a.body.length <= this.inlineTextLimit) {
          return { name: a.name, contentType: a.contentType, body: a.body.toString('utf8') };
        }
        return { name: a.name, contentType: a.contentType, path: this.writeBlob(a.body, a.contentType, a.name) };
      }
      if (a.path && fs.existsSync(a.path)) {
        const buf = fs.readFileSync(a.path);
        return { name: a.name, contentType: a.contentType, path: this.writeBlob(buf, a.contentType, a.path) };
      }
    } catch {
      // An unreadable attachment must never break the run.
    }
    return undefined;
  }

  private writeBlob(buf: Buffer, contentType: string, hint: string): string {
    const ext = EXT[contentType] ?? (path.extname(hint) || '.bin');
    const name = `${sha1(buf).slice(0, 20)}${ext}`;
    const target = path.join(this.outDir, 'attachments', name);
    if (!fs.existsSync(target)) fs.writeFileSync(target, buf);
    return `attachments/${name}`;
  }
}

function mapOutcome(test: PwTestCase): Status {
  const outcome = test.outcome();
  if (outcome === 'skipped') return 'skipped';
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'unexpected') return 'failed';
  return 'passed';
}

function convertStep(s: TestStep): Step {
  return {
    title: s.title,
    category: s.category,
    durationMs: s.duration,
    error: s.error?.message ? stripAnsi(s.error.message).split('\n')[0] : undefined,
    steps: s.steps.map(convertStep),
  };
}

function chunkToString(c: string | Buffer): string {
  return typeof c === 'string' ? c : c.toString('utf8');
}

export default SpectraReporter;
