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
import { detectCi, runIdFromEnv, sha1, stripAnsi, testId } from './util.js';
const EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/webm': '.webm',
    'application/zip': '.zip',
    'text/plain': '.txt',
    'application/json': '.json',
    'text/html': '.html',
};
class SpectraReporter {
    outDir;
    runName;
    inlineTextLimit;
    config;
    suite;
    startedAt = new Date();
    constructor(options = {}) {
        this.outDir = path.resolve(options.outputDir ?? process.env.SPECTRA_RESULTS_DIR ?? 'spectra-results');
        this.runName = options.runName ?? process.env.SPECTRA_RUN_NAME;
        this.inlineTextLimit = options.inlineTextLimit ?? 16 * 1024;
    }
    printsToStdio() {
        return false;
    }
    onBegin(config, suite) {
        this.config = config;
        this.suite = suite;
        this.startedAt = new Date();
        fs.rmSync(this.outDir, { recursive: true, force: true });
        fs.mkdirSync(path.join(this.outDir, 'attachments'), { recursive: true });
    }
    async onEnd(result) {
        const tests = this.suite.allTests().map((t) => this.convertTest(t));
        const raw = {
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
    convertTest(test) {
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
            tags: test.tags ?? [],
            annotations: test.annotations.map((a) => ({ type: a.type, description: a.description })),
            status: mapOutcome(test),
            durationMs: attempts.reduce((sum, a) => sum + a.durationMs, 0),
            attempts,
        };
    }
    convertResult(r) {
        const errors = (r.errors ?? []).map((e) => ({
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
            attachments: r.attachments.map((a) => this.saveAttachment(a)).filter((a) => !!a),
            stdout: r.stdout.map(chunkToString),
            stderr: r.stderr.map(chunkToString),
        };
    }
    saveAttachment(a) {
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
        }
        catch {
            // An unreadable attachment must never break the run.
        }
        return undefined;
    }
    writeBlob(buf, contentType, hint) {
        const ext = EXT[contentType] ?? (path.extname(hint) || '.bin');
        const name = `${sha1(buf).slice(0, 20)}${ext}`;
        const target = path.join(this.outDir, 'attachments', name);
        if (!fs.existsSync(target))
            fs.writeFileSync(target, buf);
        return `attachments/${name}`;
    }
}
function mapOutcome(test) {
    const outcome = test.outcome();
    if (outcome === 'skipped')
        return 'skipped';
    if (outcome === 'flaky')
        return 'flaky';
    if (outcome === 'unexpected')
        return 'failed';
    return 'passed';
}
function convertStep(s) {
    return {
        title: s.title,
        category: s.category,
        durationMs: s.duration,
        error: s.error?.message ? stripAnsi(s.error.message).split('\n')[0] : undefined,
        steps: s.steps.map(convertStep),
    };
}
function chunkToString(c) {
    return typeof c === 'string' ? c : c.toString('utf8');
}
export default SpectraReporter;
