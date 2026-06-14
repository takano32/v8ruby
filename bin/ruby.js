#!/usr/bin/env node
// v8ruby: compile a Ruby program to JavaScript and run it on V8 (Node).
//
//   v8ruby program.rb            run a file
//   v8ruby -e 'puts 1+1'         run a one-liner
//   v8ruby -I lib -r set app.rb  add load path entries / pre-require features
//   v8ruby --dump program.rb     print the generated JavaScript instead of running

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '../src/compiler.js';
import R, { RubyError } from '../src/runtime.js';
import { installLoader, executeFile, executeSource, requireFeature, runAtExit } from '../src/loader.js';

function main(argv) {
  const args = argv.slice(2);
  let dump = false;
  let evalSource = null;
  let file = null;
  const includes = [];
  const requires = [];
  let scriptArgs = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dump' || a === '-d') dump = true;
    else if (a === '-e') evalSource = args[++i];
    else if (a === '-I') includes.push(args[++i]);
    else if (a.startsWith('-I') && a.length > 2) includes.push(a.slice(2));
    else if (a === '-r') requires.push(args[++i]);
    else if (a.startsWith('-r') && a.length > 2) requires.push(a.slice(2));
    else if (a === '-h' || a === '--help') { printHelp(); return 0; }
    else if (a === '-v' || a === '--version') {
      console.log('v8ruby 0.1.0 (on Node ' + process.version + ', V8 ' + process.versions.v8 + ')');
      return 0;
    } else if (!a.startsWith('-')) {
      file = a;
      scriptArgs = args.slice(i + 1);
      break;
    }
  }

  if (evalSource == null && file == null) { printHelp(); return 1; }

  if (dump) {
    const source = evalSource ?? readFileSync(file, 'utf8');
    try {
      process.stdout.write(compile(source) + '\n');
      return 0;
    } catch (e) {
      process.stderr.write(`${file ?? '-e'}: ${e.message}\n`);
      return 1;
    }
  }

  installLoader({
    argv: scriptArgs,
    programName: file ?? 'v8ruby',
    extraLoadPaths: includes,
  });

  const label = file ?? '-e';
  let status = 0;
  try {
    for (const r of requires) requireFeature(r);
    if (file != null) executeFile(resolve(file));
    else executeSource(evalSource, '-e');
  } catch (e) {
    status = reportError(e, label);
  } finally {
    try { runAtExit(); } catch { /* ignore */ }
  }
  return status;
}

function reportError(e, label) {
  if (e instanceof RubyError) {
    const obj = e.rubyObj;
    const cls = R.classOf(obj);
    if (cls.name === 'SystemExit') return 0;
    let msg = '';
    try { msg = R.toS(R.send(obj, 'message', [])); } catch { msg = ''; }
    process.stderr.write(`${label}: ${msg} (${cls.name})\n`);
    return 1;
  }
  throw e;
}

function printHelp() {
  process.stdout.write(`v8ruby - Ruby on the V8 engine

Usage:
  v8ruby [options] file.rb [args...]
  v8ruby -e 'ruby code'

Options:
  -e CODE      run CODE
  -I DIR       prepend DIR to the load path ($LOAD_PATH)
  -r FEATURE   require FEATURE before running
  -d, --dump   print generated JavaScript, do not run
  -v           print version
  -h           this help

Gems installed with the real \`gem\` / \`bundle\` commands are found
automatically (GEM_HOME, GEM_PATH, ~/.local/share/gem, ~/.gem, rbenv).
`);
}

process.exit(main(process.argv));
