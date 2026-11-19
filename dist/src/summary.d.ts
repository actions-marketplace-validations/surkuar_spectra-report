/** Markdown summary for the PR comment and $GITHUB_STEP_SUMMARY. */
import type { Report } from './types.js';
export declare const COMMENT_MARKER = "<!-- spectra-report -->";
export declare function renderSummary(report: Report, opts?: {
    maxRows?: number;
}): string;
