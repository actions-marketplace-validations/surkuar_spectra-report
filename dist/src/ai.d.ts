/**
 * AI failure explanation: one call per failure group, cached by signature.
 * Providers: Anthropic Messages API (default) or any OpenAI-compatible Chat Completions API.
 * Uses global fetch — no SDK dependency.
 */
import type { AiInsight, Cluster, TestCase } from './types.js';
export type AiProvider = 'anthropic' | 'openai';
export interface AiOptions {
    provider: AiProvider;
    apiKey: string;
    model: string;
    baseUrl?: string;
    maxClusters: number;
    maxChars: number;
    timeoutMs: number;
    extraRedactions?: RegExp[];
}
export declare const DEFAULT_MODELS: Record<AiProvider, string>;
export declare function aiOptionsFromEnv(env?: NodeJS.ProcessEnv): AiOptions | undefined;
export declare const SYSTEM_PROMPT = "You are a senior test automation engineer triaging failed end-to-end tests (usually Playwright).\nYou get one group of failures that share the same error signature.\nExplain the most likely root cause and the most useful next step for the engineer.\nBe concrete and short. Never invent file names or code that is not in the input.\nReply with ONLY a JSON object, no markdown, with exactly these keys:\n{\"summary\": string (max 25 words, what is failing),\n \"likelyCause\": string (max 40 words),\n \"suggestedFix\": string (max 60 words, actionable; may include a short code hint),\n \"category\": one of \"locator\" | \"timing\" | \"test-data\" | \"environment\" | \"product-bug\" | \"assertion\" | \"unknown\",\n \"confidence\": number between 0 and 1}";
export declare function buildPrompt(cluster: Cluster, tests: TestCase[], maxChars: number, extra?: RegExp[]): string;
export declare function parseInsight(text: string, model?: string): AiInsight;
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;
export declare function callModel(prompt: string, opts: AiOptions, fetchImpl?: FetchLike): Promise<string>;
export interface ExplainResult {
    calls: number;
    cacheHits: number;
    errors: number;
}
/**
 * Adds `ai` to each cluster. Cached answers (by signature) are reused without a call.
 * Failures are recorded on the cluster as `aiError` and never thrown.
 */
export declare function explainClusters(clusters: Cluster[], testsById: Map<string, TestCase>, opts: AiOptions, cache: Record<string, AiInsight>, fetchImpl?: FetchLike, log?: (msg: string) => void): Promise<ExplainResult>;
