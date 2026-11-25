// Runs the compiled unit tests with node --test on every OS and Node version.
// (A dist/test/*.test.js glob in package.json is not expanded by cmd.exe on Windows,
// and Node only expands globs itself from v21.)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
if (files.length === 0) {
  console.error(`No *.test.js files in ${dir}`);
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
