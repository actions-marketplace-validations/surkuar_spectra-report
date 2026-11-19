import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';
export interface SpectraReporterOptions {
    /** Folder for run.json and attachments. Default: `spectra-results` (or $SPECTRA_RESULTS_DIR). */
    outputDir?: string;
    /** Optional run name shown in the report header. */
    runName?: string;
    /** Text attachments up to this size are inlined into run.json. Default 16 KB. */
    inlineTextLimit?: number;
}
declare class SpectraReporter implements Reporter {
    private readonly outDir;
    private readonly runName?;
    private readonly inlineTextLimit;
    private config;
    private suite;
    private startedAt;
    constructor(options?: SpectraReporterOptions);
    printsToStdio(): boolean;
    onBegin(config: FullConfig, suite: Suite): void;
    onEnd(result: FullResult): Promise<void>;
    private convertTest;
    private convertResult;
    private saveAttachment;
    private writeBlob;
}
export default SpectraReporter;
