#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { generate } from './generate.js';
import { passRate, VERSION } from './util.js';
const HELP = `spectra ${VERSION}: AI-assisted test reports

Usage:
  spectra generate [options]     Build a static report from test results
  spectra summary <reportDir>    Print the markdown summary of a built report

generate options:
  -r, --results <dir>      Folder written by the Playwright reporter (repeatable; default: spectra-results)
  -j, --junit <file>       JUnit XML file to import (repeatable)
  -o, --out <dir>          Output folder (default: spectra-report)
      --history <file>     history.json from the previous run
      --history-out <file> Where to write updated history (default: <out>/history.json)
      --report-url <url>   Public URL of this report, used in summary links
      --name <text>        Run name shown in the report
      --no-ai              Disable AI analysis even if an API key is set

AI (optional) is enabled when ANTHROPIC_API_KEY or OPENAI_API_KEY is set.
  SPECTRA_AI_PROVIDER=anthropic|openai  SPECTRA_AI_MODEL=<model>  SPECTRA_AI_BASE_URL=<url>
  SPECTRA_AI_MAX_CLUSTERS=10  SPECTRA_AI_MAX_CHARS=6000  SPECTRA_AI_TIMEOUT_MS=30000
`;
function parseArgs(argv) {
    const out = {
        positional: [],
        flags: {},
        bools: new Set(),
    };
    const alias = { r: 'results', j: 'junit', o: 'out', h: 'help', v: 'version' };
    const booleans = new Set(['no-ai', 'help', 'version']);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('-')) {
            let [key, val] = a.replace(/^--?/, '').split('=', 2);
            key = alias[key] ?? key;
            if (booleans.has(key)) {
                out.bools.add(key);
                continue;
            }
            if (val === undefined)
                val = argv[++i];
            if (val === undefined)
                throw new Error(`Missing value for --${key}`);
            (out.flags[key] ??= []).push(val);
        }
        else if (!out.cmd)
            out.cmd = a;
        else
            out.positional.push(a);
    }
    return out;
}
function setGithubOutputs(values) {
    const file = process.env.GITHUB_OUTPUT;
    if (!file)
        return;
    fs.appendFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.bools.has('version')) {
        console.log(VERSION);
        return 0;
    }
    if (!args.cmd || args.bools.has('help')) {
        console.log(HELP);
        return args.cmd ? 0 : 1;
    }
    if (args.cmd === 'generate') {
        const resultsDirs = args.flags.results ?? (args.flags.junit ? [] : ['spectra-results']);
        const outDir = args.flags.out?.[0] ?? 'spectra-report';
        const { report } = await generate({
            resultsDirs,
            junitFiles: args.flags.junit,
            outDir,
            historyFile: args.flags.history?.[0],
            historyOut: args.flags['history-out']?.[0],
            reportUrl: args.flags['report-url']?.[0],
            runName: args.flags.name?.[0],
            ai: args.bools.has('no-ai') ? false : undefined,
        });
        const s = report.stats;
        console.error(`spectra: ${s.total} tests, ${s.passed} passed, ${s.failed} failed, ${s.flaky} flaky, ${s.skipped} skipped, ` +
            `${report.clusters.length} failure group(s) -> ${path.resolve(outDir, 'index.html')}`);
        setGithubOutputs({
            total: s.total,
            passed: s.passed,
            failed: s.failed,
            flaky: s.flaky,
            skipped: s.skipped,
            'pass-rate': (passRate(s) * 100).toFixed(1),
            'failure-groups': report.clusters.length,
        });
        return 0;
    }
    if (args.cmd === 'summary') {
        const dir = args.positional[0] ?? 'spectra-report';
        process.stdout.write(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'));
        return 0;
    }
    console.error(`Unknown command: ${args.cmd}\n\n${HELP}`);
    return 1;
}
main().then((code) => process.exit(code), (err) => {
    console.error(`spectra: ${err?.message ?? err}`);
    process.exit(1);
});
