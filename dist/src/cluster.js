import { sha1, stripAnsi, truncate } from './util.js';
/** Replace volatile parts of an error line so equal causes compare equal. */
export function normalizeLine(line) {
    return stripAnsi(line)
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<ID>')
        .replace(/\b[0-9a-f]{10,}\b/gi, '<ID>')
        .replace(/(https?:\/\/[^\s?#'"]+)[?#][^\s'"]*/g, '$1')
        .replace(/"([^"\n]{41,})"/g, '"<STR>"')
        .replace(/'([^'\n]{41,})'/g, "'<STR>'")
        .replace(/\d+(\.\d+)?/g, '<N>')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Pull the locator a Playwright error talks about, if any. */
export function extractLocator(message) {
    const m = /^\s*Locator:\s*(.+)$/m.exec(message) ??
        /waiting for (locator\(.+?\)|getBy\w+\(.+?\)(?:\.\w+\(.*?\))*)/.exec(message) ??
        /(locator\('[^']+'\)|getBy\w+\([^)]*\))/.exec(message);
    return m ? m[1].trim() : undefined;
}
export function primaryError(test) {
    for (let i = test.attempts.length - 1; i >= 0; i--) {
        const e = test.attempts[i].errors[0];
        if (e)
            return e;
    }
    return undefined;
}
export function errorSignature(err) {
    const lines = stripAnsi(err.message)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const head = normalizeLine(lines[0] ?? 'Unknown error');
    const locator = extractLocator(err.message);
    return locator && !head.includes(locator) ? `${head} — ${normalizeLine(locator)}` : head;
}
export function humanTitle(err) {
    const lines = stripAnsi(err.message).split('\n').map((l) => l.trim()).filter(Boolean);
    const head = (lines[0] ?? 'Unknown error').replace(/^Error:\s*/, '');
    const locator = extractLocator(err.message);
    return truncate(locator && !head.includes(locator) ? `${head} — ${locator}` : head, 140);
}
/** Group failed tests by signature; ranked by tests affected, then new failures. */
export function clusterFailures(tests) {
    const map = new Map();
    for (const t of tests) {
        if (t.status !== 'failed')
            continue;
        const err = primaryError(t) ?? { message: 'Failed without an error message' };
        const signature = errorSignature(err);
        const id = 'c-' + sha1(signature).slice(0, 10);
        let c = map.get(id);
        if (!c) {
            c = { id, signature, title: humanTitle(err), testIds: [], newFailures: 0, sampleError: truncate(err.message, 2000) };
            map.set(id, c);
        }
        c.testIds.push(t.id);
        if (t.isNewFailure)
            c.newFailures++;
        t.clusterId = id;
    }
    return [...map.values()].sort((a, b) => b.testIds.length - a.testIds.length || b.newFailures - a.newFailures);
}
