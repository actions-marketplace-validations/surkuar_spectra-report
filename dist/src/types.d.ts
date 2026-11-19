/** Spectra Report data model, schema version 1. */
export type Status = 'passed' | 'failed' | 'flaky' | 'skipped';
export type AttemptStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
export interface ErrorInfo {
    message: string;
    stack?: string;
    snippet?: string;
    location?: {
        file: string;
        line: number;
        column: number;
    };
}
export interface Step {
    title: string;
    category?: string;
    durationMs: number;
    error?: string;
    steps: Step[];
}
export interface Attachment {
    name: string;
    contentType: string;
    /** Path relative to the results/report folder, e.g. "attachments/ab12.png". */
    path?: string;
    /** Inline text body for small text attachments. */
    body?: string;
}
export interface Attempt {
    retry: number;
    status: AttemptStatus;
    durationMs: number;
    startedAt?: string;
    errors: ErrorInfo[];
    steps: Step[];
    attachments: Attachment[];
    stdout: string[];
    stderr: string[];
}
export interface HistoryEntry {
    runId: string;
    at: string;
    status: Status;
    durationMs: number;
}
export interface TestCase {
    id: string;
    title: string;
    titlePath: string[];
    file: string;
    line?: number;
    project?: string;
    tags: string[];
    annotations: {
        type: string;
        description?: string;
    }[];
    status: Status;
    durationMs: number;
    attempts: Attempt[];
    /** Filled in by `generate`: previous results, oldest first (excludes this run). */
    history?: HistoryEntry[];
    flakeRate?: number;
    isNewFailure?: boolean;
    clusterId?: string;
}
export interface CiInfo {
    provider: string;
    repo?: string;
    branch?: string;
    baseBranch?: string;
    commit?: string;
    pr?: number;
    runUrl?: string;
    runNumber?: string;
    actor?: string;
}
export interface RunInfo {
    id: string;
    name?: string;
    startedAt: string;
    durationMs: number;
    framework: string;
    frameworkVersion?: string;
    ci?: CiInfo;
}
export interface Stats {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
}
export type AiCategory = 'locator' | 'timing' | 'test-data' | 'environment' | 'product-bug' | 'assertion' | 'unknown';
export interface AiInsight {
    summary: string;
    likelyCause: string;
    suggestedFix: string;
    category: AiCategory;
    confidence: number;
    model?: string;
    cached?: boolean;
}
export interface Cluster {
    id: string;
    signature: string;
    title: string;
    testIds: string[];
    newFailures: number;
    sampleError: string;
    ai?: AiInsight;
    aiError?: string;
}
export interface TrendPoint {
    runId: string;
    at: string;
    stats: Stats;
    durationMs: number;
}
/** What a reporter or importer writes: `spectra-results/run.json`. */
export interface RawRun {
    schemaVersion: 1;
    run: RunInfo;
    tests: TestCase[];
}
/** What `spectra generate` writes for the viewer: `data/report.json`. */
export interface Report {
    schemaVersion: 1;
    generator: string;
    generatedAt: string;
    reportUrl?: string;
    run: RunInfo;
    stats: Stats;
    tests: TestCase[];
    clusters: Cluster[];
    trend: TrendPoint[];
}
/** Persisted between runs (on gh-pages): `history.json`. */
export interface HistoryFile {
    version: 1;
    runs: TrendPoint[];
    tests: Record<string, HistoryEntry[]>;
    aiCache: Record<string, AiInsight>;
}
