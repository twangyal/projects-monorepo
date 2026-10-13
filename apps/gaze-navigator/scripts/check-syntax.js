// Syntax-checks every JavaScript module the app ships or tests, so new files cannot be skipped.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'scripts', 'browser-tests', 'tests', 'test-support', 'practice-site'];
const files = ['playwright.config.js'];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.js')) files.push(path);
  }
}
roots.forEach(walk);
for (const file of files.sort()) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`Syntax OK: ${files.length} files.`);
