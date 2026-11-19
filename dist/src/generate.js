import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clusterFailures } from './cluster.js';
import { annotateWithHistory, loadHistory, nextHistory } from './history.js';
import { aiOptionsFromEnv, explainClusters } from './ai.js';
import { importJUnit } from './importers/junit.js';
import { renderSummary } from './summary.js';
import { computeStats, VERSION } from './util.js';
const here = path.dirname(fileURLToPath(import.meta.url));
export function viewerTemplatePath() {
    // dist/src/generate.js -> ../../viewer/index.html ; src/generate.ts (ts-node) -> ../viewer
    for (const p of [path.resolve(here, '../../viewer/index.html'), path.resolve(here, '../viewer/index.html')]) {
        if (fs.existsSync(p))
            return p;
    }
    throw new Error('spectra: viewer/index.html not found next to the package');
}
function mergeRuns(runs) {
    if (runs.length === 0)
        throw new Error('spectra: no results found. Pass --results <dir> or --junit <file>.');
    const first = runs[0];
    const started = Math.min(...runs.map((r) => Date.parse(r.run.startedAt)));
    const ended = Math.max(...runs.map((r) => Date.parse(r.run.startedAt) + r.run.durationMs));
    const seen = new Map();
    for (const r of runs)
        for (const t of r.tests)
            seen.set(t.id, t); // later shard wins on duplicates
    return {
        run: { ...first.run, startedAt: new Date(started).toISOString(), durationMs: Math.max(0, ended - started) },
        tests: [...seen.values()],
    };
}
function copyDir(src, dest) {
    if (!fs.existsSync(src))
        return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory())
            copyDir(s, d);
        else if (!fs.existsSync(d))
            fs.copyFileSync(s, d);
    }
}
/** JSON that is safe to embed in a <script> or .js file. */
export function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
export async function generate(opts) {
    const log = opts.log ?? ((m) => console.error(m));
    const raws = [];
    const outDir = path.resolve(opts.outDir);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
    for (const dir of opts.resultsDirs ?? []) {
        const file = path.join(dir, 'run.json');
        if (!fs.existsSync(file)) {
            log(`spectra: ${file} not found, skipping`);
            continue;
        }
        raws.push(JSON.parse(fs.readFileSync(file, 'utf8')));
        copyDir(path.join(dir, 'attachments'), path.join(outDir, 'data', 'attachments'));
    }
    for (const f of opts.junitFiles ?? [])
        raws.push(importJUnit(fs.readFileSync(f, 'utf8'), path.basename(f)));
    const { run, tests } = mergeRuns(raws);
    if (opts.runName)
        run.name = opts.runName;
    // Attachment paths are relative to results dir; in the report they live under data/.
    for (const t of tests)
        for (const a of t.attempts)
            for (const att of a.attachments)
                if (att.path && !att.path.startsWith('data/'))
                    att.path = `data/${att.path}`;
    const history = loadHistory(opts.historyFile);
    annotateWithHistory(tests, history);
    const clusters = clusterFailures(tests);
    const ai = opts.ai === false ? undefined : (opts.ai ?? aiOptionsFromEnv());
    const aiCache = { ...history.aiCache };
    if (ai && clusters.length) {
        const byId = new Map(tests.map((t) => [t.id, t]));
        const r = await explainClusters(clusters, byId, ai, aiCache, opts.fetchImpl, log);
        log(`spectra: AI analysed ${r.calls} group(s), ${r.cacheHits} from cache, ${r.errors} error(s) [${ai.provider}/${ai.model}]`);
    }
    const stats = computeStats(tests);
    const report = {
        schemaVersion: 1,
        generator: `spectra-report ${VERSION}`,
        generatedAt: new Date().toISOString(),
        reportUrl: opts.reportUrl,
        run,
        stats,
        tests,
        clusters,
        trend: [],
    };
    const newHistory = nextHistory({ ...history, aiCache }, report);
    report.trend = newHistory.runs.slice(-30);
    fs.copyFileSync(viewerTemplatePath(), path.join(outDir, 'index.html'));
    fs.writeFileSync(path.join(outDir, 'data', 'report.js'), `window.__SPECTRA_REPORT__ = ${safeJson(report)};\n`);
    fs.writeFileSync(path.join(outDir, 'data', 'report.json'), JSON.stringify(report));
    const summary = renderSummary(report);
    fs.writeFileSync(path.join(outDir, 'summary.md'), summary);
    const historyOut = opts.historyOut ?? path.join(outDir, 'history.json');
    fs.mkdirSync(path.dirname(path.resolve(historyOut)), { recursive: true });
    fs.writeFileSync(historyOut, JSON.stringify(newHistory));
    return { report, history: newHistory, summary, outDir };
}
