/** Masks secrets before any text leaves the runner. */
const DEFAULT_PATTERNS = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '<PRIVATE_KEY>'],
    [/\b(authorization|proxy-authorization)\s*[:=]\s*["']?[^\s"',}]+(\s+[^\s"',}]+)?/gi, '$1: <REDACTED>'],
    [/\bbearer\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer <REDACTED>'],
    [/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '<JWT>'],
    [/\bsk-ant-[a-zA-Z0-9_-]{10,}/g, '<ANTHROPIC_KEY>'],
    [/\bsk-[a-zA-Z0-9_-]{20,}/g, '<OPENAI_KEY>'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '<GITHUB_TOKEN>'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '<GITHUB_TOKEN>'],
    [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '<AWS_KEY>'],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '<SLACK_TOKEN>'],
    [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1<REDACTED>@'],
    [/\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)(["']?\s*[:=]\s*)["']?[^\s"',}&]+/gi, '$1$2<REDACTED>'],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<EMAIL>'],
];
export function redact(text, extra = []) {
    let out = text;
    for (const [re, repl] of DEFAULT_PATTERNS)
        out = out.replace(re, repl);
    for (const re of extra)
        out = out.replace(re, '<REDACTED>');
    return out;
}
