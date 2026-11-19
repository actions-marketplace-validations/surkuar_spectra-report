import { primaryError } from './cluster.js';
import { redact } from './redact.js';
import { truncate } from './util.js';
export const DEFAULT_MODELS = {
    anthropic: 'claude-haiku-5-5',
    openai: 'gpt-4.1-mini',
};
export function aiOptionsFromEnv(env = process.env) {
    if (env.SPECTRA_AI === 'off' || env.SPECTRA_AI === 'false')
        return undefined;
    const explicit = env.SPECTRA_AI_PROVIDER;
    const provider = explicit ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : undefined);
    if (!provider)
        return undefined;
    const apiKey = env.SPECTRA_AI_API_KEY ?? (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY);
    if (!apiKey && !env.SPECTRA_AI_BASE_URL)
        return undefined;
    return {
        provider,
        apiKey: apiKey ?? '',
        model: env.SPECTRA_AI_MODEL || DEFAULT_MODELS[provider],
        baseUrl: env.SPECTRA_AI_BASE_URL || undefined,
        maxClusters: Number(env.SPECTRA_AI_MAX_CLUSTERS ?? 10),
        maxChars: Number(env.SPECTRA_AI_MAX_CHARS ?? 6000),
        timeoutMs: Number(env.SPECTRA_AI_TIMEOUT_MS ?? 30000),
    };
}
export const SYSTEM_PROMPT = `You are a senior test automation engineer triaging failed end-to-end tests (usually Playwright).
You get one group of failures that share the same error signature.
Explain the most likely root cause and the most useful next step for the engineer.
Be concrete and short. Never invent file names or code that is not in the input.
Reply with ONLY a JSON object, no markdown, with exactly these keys:
{"summary": string (max 25 words, what is failing),
 "likelyCause": string (max 40 words),
 "suggestedFix": string (max 60 words, actionable; may include a short code hint),
 "category": one of "locator" | "timing" | "test-data" | "environment" | "product-bug" | "assertion" | "unknown",
 "confidence": number between 0 and 1}`;
export function buildPrompt(cluster, tests, maxChars, extra = []) {
    const parts = [];
    parts.push(`Error signature: ${cluster.signature}`);
    parts.push(`Tests affected: ${cluster.testIds.length} (${cluster.newFailures} new since the previous run)`);
    const list = tests.slice(0, 10).map((t) => `- ${[t.project, t.file, ...t.titlePath].filter(Boolean).join(' > ')}`);
    parts.push(`Affected tests:\n${list.join('\n')}${tests.length > 10 ? `\n- ...and ${tests.length - 10} more` : ''}`);
    for (const [i, t] of tests.slice(0, 3).entries()) {
        const err = primaryError(t);
        const lastAttempt = t.attempts[t.attempts.length - 1];
        const failedSteps = lastAttempt ? flattenSteps(lastAttempt.steps).filter((s) => s.error).map((s) => s.title) : [];
        const recentSteps = lastAttempt ? flattenSteps(lastAttempt.steps).slice(-8).map((s) => s.title) : [];
        parts.push([
            `Example ${i + 1}: ${t.titlePath.join(' > ')}`,
            `Retries: ${t.attempts.length - 1}. History (oldest first): ${(t.history ?? []).slice(-10).map((h) => h.status).join(', ') || 'none'}`,
            err ? `Error:\n${truncate(err.message, 1500)}` : '',
            err?.snippet ? `Code snippet:\n${truncate(err.snippet, 1200)}` : '',
            failedSteps.length ? `Failed steps: ${failedSteps.join(' | ')}` : '',
            recentSteps.length ? `Last steps: ${recentSteps.join(' | ')}` : '',
        ]
            .filter(Boolean)
            .join('\n'));
    }
    return truncate(redact(parts.join('\n\n'), extra), maxChars);
}
function flattenSteps(steps) {
    const out = [];
    for (const s of steps) {
        out.push(s);
        out.push(...flattenSteps(s.steps));
    }
    return out;
}
const CATEGORIES = ['locator', 'timing', 'test-data', 'environment', 'product-bug', 'assertion', 'unknown'];
export function parseInsight(text, model) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
        throw new Error('AI reply contained no JSON object');
    const obj = JSON.parse(text.slice(start, end + 1));
    const str = (v, max) => truncate(typeof v === 'string' ? v.trim() : '', max);
    const category = CATEGORIES.includes(obj.category) ? obj.category : 'unknown';
    const confidence = Math.min(1, Math.max(0, Number(obj.confidence) || 0));
    const insight = {
        summary: str(obj.summary, 300),
        likelyCause: str(obj.likelyCause, 500),
        suggestedFix: str(obj.suggestedFix, 800),
        category,
        confidence,
        model,
    };
    if (!insight.summary && !insight.likelyCause)
        throw new Error('AI reply was missing summary and likelyCause');
    return insight;
}
export async function callModel(prompt, opts, fetchImpl = fetch) {
    const signal = AbortSignal.timeout(opts.timeoutMs);
    if (opts.provider === 'anthropic') {
        const url = `${(opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: opts.model, max_tokens: 700, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] }),
            signal,
        });
        const body = await res.text();
        if (!res.ok)
            throw new Error(`Anthropic API ${res.status}: ${truncate(body, 300)}`);
        const json = JSON.parse(body);
        return (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    }
    const url = `${(opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
    const headers = { 'content-type': 'application/json' };
    if (opts.apiKey)
        headers.authorization = `Bearer ${opts.apiKey}`;
    const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: opts.model,
            temperature: 0.2,
            max_tokens: 700,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt },
            ],
        }),
        signal,
    });
    const body = await res.text();
    if (!res.ok)
        throw new Error(`OpenAI-compatible API ${res.status}: ${truncate(body, 300)}`);
    const json = JSON.parse(body);
    return json.choices?.[0]?.message?.content ?? '';
}
/**
 * Adds `ai` to each cluster. Cached answers (by signature) are reused without a call.
 * Failures are recorded on the cluster as `aiError` and never thrown.
 */
export async function explainClusters(clusters, testsById, opts, cache, fetchImpl, log = () => { }) {
    const result = { calls: 0, cacheHits: 0, errors: 0 };
    for (const c of clusters) {
        const cached = cache[c.signature];
        if (cached) {
            c.ai = { ...cached, cached: true };
            result.cacheHits++;
            continue;
        }
        if (result.calls >= opts.maxClusters)
            continue;
        result.calls++;
        try {
            const tests = c.testIds.map((id) => testsById.get(id)).filter((t) => !!t);
            const text = await callModel(buildPrompt(c, tests, opts.maxChars, opts.extraRedactions), opts, fetchImpl);
            c.ai = parseInsight(text, opts.model);
            cache[c.signature] = { ...c.ai, cached: undefined };
        }
        catch (e) {
            result.errors++;
            c.aiError = truncate(String(e?.message ?? e), 300);
            log(`spectra: AI analysis skipped for "${truncate(c.title, 60)}": ${c.aiError}`);
        }
    }
    return result;
}
