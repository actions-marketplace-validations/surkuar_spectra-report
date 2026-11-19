import type { HistoryFile, Report } from './types.js';
import { type AiOptions, type FetchLike } from './ai.js';
export interface GenerateOptions {
    /** Folders written by the Playwright reporter (several = shards, merged). */
    resultsDirs?: string[];
    /** JUnit XML files to import. */
    junitFiles?: string[];
    /** Output folder for the static report. */
    outDir: string;
    /** history.json from the previous run (missing file = first run). */
    historyFile?: string;
    /** Where to write the updated history. Default: <outDir>/history.json */
    historyOut?: string;
    /** Public URL of this report, used for links in the summary. */
    reportUrl?: string;
    runName?: string;
    /** AI options; `false` disables AI; undefined = read from environment. */
    ai?: AiOptions | false;
    fetchImpl?: FetchLike;
    log?: (msg: string) => void;
}
export interface GenerateResult {
    report: Report;
    history: HistoryFile;
    summary: string;
    outDir: string;
}
export declare function viewerTemplatePath(): string;
/** JSON that is safe to embed in a <script> or .js file. */
export declare function safeJson(value: unknown): string;
export declare function generate(opts: GenerateOptions): Promise<GenerateResult>;
