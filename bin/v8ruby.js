#!/usr/bin/env node
// v8ruby: compile a Ruby program to JavaScript and run it on V8 (Node).
//
//   v8ruby program.rb        run a file
//   v8ruby -e 'puts 1+1'     run a one-liner
//   v8ruby --dump program.rb print the generated JavaScript instead of running

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../src/compiler.js';
import R, { RubyError } from '../src/runtime.js';

function main(argv) {
  const args = argv.slice(2);
  let dump = false;
  let source = null;
  let filename = '(eval)';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dump' || a === '-d') dump = true;
    else if (a === '-e') { source = args[++i]; }
    else if (a === '-h' || a === '--help') { printHelp(); return 0; }
    else if (a === '-v' || a === '--version') { console.log('v8ruby 0.1.0 (on Node ' + process.version + ', V8 ' + process.versions.v8 + ')'); return 0; }
    else if (!a.startsWith('-')) { filename = a; source = readFileSync(a, 'utf8'); }
  }

  if (source == null) { printHelp(); return 1; }

  let js;
  try {
    js = compile(source);
  } catch (e) {
    process.stderr.write(`${filename}: ${e.message}\n`);
    return 1;
  }

  if (dump) {
    process.stdout.write(js + '\n');
    return 0;
  }

  // Execute the generated JavaScript on V8.
  let fn;
  try {
    fn = new Function('R', js);
  } catch (e) {
    process.stderr.write(`codegen error: ${e.message}\n`);
    process.stderr.write(js + '\n');
    return 1;
  }

  try {
    fn(R);
  } catch (e) {
    if (e instanceof RubyError) {
      const obj = e.rubyObj;
      const cls = R.classOf(obj);
      let msg = '';
      try { msg = R.toS(R.send(obj, 'message', [])); } catch { msg = ''; }
      if (cls.name === 'SystemExit') return 0;
      process.stderr.write(`${filename}: ${msg} (${cls.name})\n`);
      return 1;
    }
    throw e;
  }
  return 0;
}

function printHelp() {
  process.stdout.write(`v8ruby - Ruby on the V8 engine

Usage:
  v8ruby [options] file.rb
  v8ruby -e 'ruby code'

Options:
  -e CODE      run CODE
  -d, --dump   print generated JavaScript, do not run
  -v           print version
  -h           this help
`);
}

process.exit(main(process.argv));
