// Differential test runner: run every test/cases/*.rb through both the real
// `ruby` interpreter (if available) and v8ruby, and diff their stdout/stderr.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const casesDir = join(__dirname, 'cases');
const v8ruby = join(__dirname, '..', 'bin', 'ruby.js');

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

const hasRuby = (() => { try { execFileSync('ruby', ['--version']); return true; } catch { return false; } })();

let pass = 0, fail = 0;
const failures = [];
const files = readdirSync(casesDir).filter((f) => f.endsWith('.rb')).sort();

for (const f of files) {
  const path = join(casesDir, f);
  const got = run('node', [v8ruby, path]);
  let expected;
  const expFile = path.replace(/\.rb$/, '.out');
  if (existsSync(expFile)) expected = readFileSync(expFile, 'utf8');
  else if (hasRuby) expected = run('ruby', [path]);
  else { console.log(`SKIP ${f} (no ruby, no .out)`); continue; }

  if (got === expected) { pass++; console.log(`PASS ${f}`); }
  else {
    fail++;
    failures.push({ f, expected, got });
    console.log(`FAIL ${f}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
for (const { f, expected, got } of failures) {
  console.log(`\n===== ${f} =====`);
  console.log('--- expected ---\n' + expected);
  console.log('--- got ---\n' + got);
}
process.exit(fail === 0 ? 0 : 1);
