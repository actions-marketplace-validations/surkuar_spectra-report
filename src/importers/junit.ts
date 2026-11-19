/**
 * JUnit XML importer — gives every framework (TestNG, pytest, Cucumber-JVM, Jest...)
 * basic support. Zero dependencies: a small tolerant XML parser is included.
 */
import type { RawRun, Status, TestCase } from '../types.js';
import { runIdFromEnv, detectCi, testId } from '../util.js';

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (stack.length > 1) stack.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(m[4] ?? ''))) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      const node: XmlNode = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  return root;
}

function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function importJUnit(xml: string, sourceName = 'junit.xml'): RawRun {
  const root = parseXml(xml);
  const startedAt = new Date();
  const tests: TestCase[] = [];
  for (const suite of findAll(root, 'testsuite')) {
    const suiteName = suite.attrs.name ?? '';
    for (const tc of suite.children.filter((c) => c.name === 'testcase')) {
      const title = tc.attrs.name ?? 'unnamed';
      const file = (tc.attrs.file ?? tc.attrs.classname ?? suiteName ?? sourceName).replace(/\\/g, '/');
      const titlePath = [suiteName, title].filter(Boolean);
      const failure = tc.children.find((c) => c.name === 'failure' || c.name === 'error');
      const skipped = tc.children.find((c) => c.name === 'skipped');
      const flakyFailures = tc.children.filter((c) => c.name === 'flakyFailure' || c.name === 'rerunFailure');
      let status: Status = 'passed';
      if (skipped) status = 'skipped';
      else if (failure) status = 'failed';
      else if (flakyFailures.length) status = 'flaky';
      const durationMs = Math.round(parseFloat(tc.attrs.time ?? '0') * 1000) || 0;
      const errFrom = (n: XmlNode) => {
        const msg = n.attrs.message ?? '';
        const body = n.text.trim();
        const message = [n.attrs.type ? `${n.attrs.type}: ${msg}` : msg, body && body !== msg ? body : ''].filter(Boolean).join('\n');
        return { message: message || 'Failed', stack: body || undefined };
      };
      const sysOut = tc.children.find((c) => c.name === 'system-out')?.text.trim();
      const sysErr = tc.children.find((c) => c.name === 'system-err')?.text.trim();
      const attempts = [
        ...flakyFailures.map((f, i) => ({
          retry: i,
          status: 'failed' as const,
          durationMs: 0,
          errors: [errFrom(f)],
          steps: [],
          attachments: [],
          stdout: [],
          stderr: [],
        })),
        {
          retry: flakyFailures.length,
          status: status === 'skipped' ? ('skipped' as const) : failure ? ('failed' as const) : ('passed' as const),
          durationMs,
          errors: failure ? [errFrom(failure)] : [],
          steps: [],
          attachments: [],
          stdout: sysOut ? [sysOut] : [],
          stderr: sysErr ? [sysErr] : [],
        },
      ];
      tests.push({
        id: testId(undefined, file, titlePath),
        title,
        titlePath,
        file,
        tags: [],
        annotations: skipped?.attrs.message ? [{ type: 'skip', description: skipped.attrs.message }] : [],
        status,
        durationMs,
        attempts,
      });
    }
  }
  const total = tests.reduce((s, t) => s + t.durationMs, 0);
  return {
    schemaVersion: 1,
    run: {
      id: runIdFromEnv(process.env, startedAt),
      startedAt: startedAt.toISOString(),
      durationMs: total,
      framework: 'junit',
      ci: detectCi(),
    },
    tests,
  };
}
