// Loader: Kernel#require / require_relative / load, $LOAD_PATH ($:),
// $LOADED_FEATURES ($"), and RubyGems-style gem discovery & activation.
//
// Gems are installed by the real `gem` / `bundle` tools; v8ruby finds them by
// scanning the standard gem homes (GEM_HOME, GEM_PATH, ~/.local/share/gem,
// ~/.gem, rbenv versions), reads dependencies out of the generated *.gemspec
// stubs with a regex (they are machine-written and regular), and "activates" a
// gem by prepending its lib directory to $LOAD_PATH.

import * as fs from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compile } from './compiler.js';
import R from './runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STDLIB_DIR = join(__dirname, '..', 'lib');

const loadedFeatures = new Set(); // absolute paths, JS-side fast lookup
const fileStack = [];             // files currently being executed
const activatedGems = new Set();  // gem dirs already on the load path
let gemIndex = null;              // lazy: name -> [{name, version, dir, lib, spec}...] (desc by version)
let stdlibNames = null;           // lazy: basenames of our lib/*.rb shims

const jstr = (v) => (v && v.value !== undefined ? v.value : String(v));

// ---- $LOAD_PATH helpers -----------------------------------------------------
function loadPath() {
  let lp = R.gvarGet('$LOAD_PATH');
  if (!Array.isArray(lp)) { lp = []; R.gvarSet('$LOAD_PATH', lp); }
  return lp;
}
function unshiftLoadPath(dir) {
  const lp = loadPath();
  if (!lp.some((x) => jstr(x) === dir)) lp.unshift(R.str(dir));
}

function raiseLoadError(msg) {
  R.raiseError(R.constGet('LoadError'), msg);
}

// ---- feature resolution -----------------------------------------------------
function tryFile(p) {
  try { if (fs.statSync(p).isFile()) return fs.realpathSync(p); } catch { /* missing */ }
  return null;
}
function candidate(base) {
  return tryFile(base) || (base.endsWith('.rb') ? null : tryFile(base + '.rb'));
}

function resolveFeature(name) {
  if (isAbsolute(name)) return candidate(name);
  if (name.startsWith('./') || name.startsWith('../')) return candidate(resolve(process.cwd(), name));
  for (const dir of loadPath()) {
    const r = candidate(join(jstr(dir), name));
    if (r) return r;
  }
  return null;
}

// ---- gem discovery ----------------------------------------------------------
function gemBaseDirs() {
  const dirs = [];
  const add = (d) => { if (d && fs.existsSync(join(d, 'gems'))) dirs.push(d); };
  if (process.env.GEM_HOME) add(process.env.GEM_HOME);
  for (const d of (process.env.GEM_PATH || '').split(':')) add(d);
  for (const base of [join(homedir(), '.local', 'share', 'gem', 'ruby'), join(homedir(), '.gem', 'ruby')]) {
    try { for (const v of fs.readdirSync(base)) add(join(base, v)); } catch { /* none */ }
  }
  const rbenv = join(homedir(), '.rbenv', 'versions');
  try {
    for (const v of fs.readdirSync(rbenv)) {
      const g = join(rbenv, v, 'lib', 'ruby', 'gems');
      try { for (const gv of fs.readdirSync(g)) add(join(g, gv)); } catch { /* none */ }
    }
  } catch { /* no rbenv */ }
  return [...new Set(dirs)];
}

function cmpVersion(a, b) {
  const as = a.split('.'), bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? '0', y = bs[i] ?? '0';
    const nx = parseInt(x, 10), ny = parseInt(y, 10);
    if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx !== ny) return nx - ny;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function buildGemIndex() {
  gemIndex = new Map();
  for (const base of gemBaseDirs()) {
    let entries;
    try { entries = fs.readdirSync(join(base, 'gems')); } catch { continue; }
    for (const entry of entries) {
      const m = entry.match(/^(.+)-(\d[A-Za-z0-9.]*)$/);
      if (!m) continue;
      const [, name, version] = m;
      const dir = join(base, 'gems', entry);
      const lib = join(dir, 'lib');
      if (!fs.existsSync(lib)) continue;
      const spec = join(base, 'specifications', entry + '.gemspec');
      if (!gemIndex.has(name)) gemIndex.set(name, []);
      gemIndex.get(name).push({ name, version, dir, lib, spec: fs.existsSync(spec) ? spec : null });
    }
  }
  for (const list of gemIndex.values()) list.sort((a, b) => cmpVersion(b.version, a.version));
}

function gemDeps(g) {
  if (!g.spec) return [];
  let txt;
  try { txt = fs.readFileSync(g.spec, 'utf8'); } catch { return []; }
  const deps = [];
  const re = /\badd_(?:runtime_)?dependency\(?\s*(?:%q<([^>]+)>|["']([^"']+)["'])/g;
  let m;
  while ((m = re.exec(txt))) deps.push(m[1] || m[2]);
  return deps;
}

function stdlibHas(name) {
  if (stdlibNames === null) {
    stdlibNames = new Set();
    try { for (const f of fs.readdirSync(STDLIB_DIR)) if (f.endsWith('.rb')) stdlibNames.add(f.slice(0, -3)); } catch { /* none */ }
  }
  return stdlibNames.has(name.split('/')[0]);
}

// Activate a gem: put its lib dir (and its dependencies') on $LOAD_PATH.
export function activateGem(name, version = null, { skipStdlibShadow = false } = {}) {
  if (!gemIndex) buildGemIndex();
  const list = gemIndex.get(name);
  if (!list || !list.length) return false;
  let g = list[0];
  if (version) {
    const exact = list.find((x) => x.version === jstr(version));
    if (exact) g = exact;
  }
  if (activatedGems.has(g.dir)) return true;
  if (skipStdlibShadow && stdlibHas(name)) return true; // don't shadow our stdlib shims
  activatedGems.add(g.dir);
  unshiftLoadPath(g.lib);
  for (const dep of gemDeps(g)) activateGem(dep, null, { skipStdlibShadow: true });
  return true;
}

// When a plain require misses, see if some installed gem provides the feature.
function tryActivateFor(name) {
  if (stdlibHas(name)) return false;
  if (!gemIndex) buildGemIndex();
  const head = name.split('/')[0];
  // common case: feature path starts with the gem name (rainbow/global → rainbow)
  for (const candidateName of [head, head.replace(/_/g, '-'), name.replace(/\//g, '-')]) {
    if (gemIndex.has(candidateName)) {
      const g = gemIndex.get(candidateName)[0];
      if (candidate(join(g.lib, name))) return activateGem(candidateName);
    }
  }
  // fallback: scan every gem's latest version for the file
  for (const list of gemIndex.values()) {
    const g = list[0];
    if (candidate(join(g.lib, name))) return activateGem(g.name);
  }
  return false;
}

// ---- execution ----------------------------------------------------------
export function currentFile() {
  return fileStack.length ? fileStack[fileStack.length - 1] : null;
}

export function executeFile(absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  executeSource(src, absPath);
}

export function executeSource(src, path) {
  let js;
  try {
    js = compile(src);
  } catch (e) {
    R.raiseError(R.constGet('SyntaxError'), `${path}: ${e.message}`);
  }
  let fn;
  try {
    fn = new Function('R', js);
  } catch (e) {
    R.raiseError(R.constGet('SyntaxError'), `${path}: generated code error: ${e.message}`);
  }
  fileStack.push(path);
  R.pushDefinee(R.consts.get('Object'));
  try {
    fn(R);
  } finally {
    fileStack.pop();
    R.popDefinee();
  }
}

// Native extensions (.so/.bundle/.dll) can't be loaded by a JS runtime.
const NATIVE_EXT = /\.(so|bundle|dll|dylib)$/;

// ---- require family -------------------------------------------------------
export function requireFeature(name) {
  if (NATIVE_EXT.test(name)) raiseLoadError(`cannot load such file -- ${name}`);
  let abs = resolveFeature(name);
  if (!abs && tryActivateFor(name)) abs = resolveFeature(name);
  if (!abs) raiseLoadError(`cannot load such file -- ${name}`);
  if (loadedFeatures.has(abs)) return false;
  loadedFeatures.add(abs); // before executing: circular requires return false
  R.gvarGet('$LOADED_FEATURES').push(R.str(abs));
  executeFile(abs);
  return true;
}

export function requireRelative(name) {
  const cur = currentFile();
  if (!cur || cur === '(eval)' || cur === '-e') {
    raiseLoadError('cannot infer basepath');
  }
  const abs = candidate(resolve(dirname(cur), name));
  if (!abs) raiseLoadError(`cannot load such file -- ${name}`);
  if (loadedFeatures.has(abs)) return false;
  loadedFeatures.add(abs);
  R.gvarGet('$LOADED_FEATURES').push(R.str(abs));
  executeFile(abs);
  return true;
}

export function loadFile(name) {
  let abs = isAbsolute(name) || name.startsWith('./') || name.startsWith('../')
    ? tryFile(resolve(process.cwd(), name))
    : resolveFeature(name);
  if (!abs) raiseLoadError(`cannot load such file -- ${name}`);
  executeFile(abs);
  return true;
}

// ---- installation -----------------------------------------------------------
export function installLoader({ argv = [], programName = 'v8ruby', extraLoadPaths = [] } = {}) {
  // $LOAD_PATH: -I dirs first, then our Ruby stdlib shims.
  const lp = [];
  for (const d of extraLoadPaths) lp.push(R.str(resolve(d)));
  lp.push(R.str(STDLIB_DIR));
  R.gvarSet('$LOAD_PATH', lp);
  R.gvarSet('$LOADED_FEATURES', []);
  R.gvarSet('$PROGRAM_NAME', R.str(programName));

  // ARGV
  const argvArr = R.consts.get('ARGV');
  argvArr.length = 0;
  for (const a of argv) argvArr.push(R.str(a));

  R.__require = requireFeature;
  R.currentFile = () => R.str(currentFile() || '(eval)');

  const ObjectC = R.consts.get('Object');
  const def = (name, fn) => ObjectC.methods.set(name, fn);

  def('require', (self, args) => requireFeature(jstr(args[0])));
  def('require_relative', (self, args) => requireRelative(jstr(args[0])));
  def('load', (self, args) => loadFile(jstr(args[0])));
  def('__dir__', () => { const c = currentFile(); return c ? R.str(dirname(c)) : null; });
  def('gem', (self, args) => {
    // During Gemfile DSL capture (Bundler.require), just record the call
    // along with the `group … do` blocks currently in effect.
    const cap = R.gvarGet('$__gemfile_capture');
    if (Array.isArray(cap)) {
      const groups = R.gvarGet('$__gemfile_groups');
      cap.push([args, Array.isArray(groups) ? groups.slice() : []]);
      return true;
    }
    const name = jstr(args[0]);
    const version = args.length > 1 && args[1] && !(args[1] instanceof R.RHash) ? jstr(args[1]).replace(/^[~><=\s]+/, '') : null;
    if (!activateGem(name, version)) raiseLoadError(`cannot activate gem -- ${name}`);
    return true;
  });

  // Gem module: discovery API used by our rubygems/bundler shims.
  const GemM = (() => {
    if (R.consts.has('Gem')) return R.consts.get('Gem');
    const m = new R.RClass('Gem', null, true);
    R.consts.set('Gem', m);
    return m;
  })();
  const sdef = (name, fn) => GemM.smethods.set(name, fn);
  sdef('path', () => gemBaseDirs().map((d) => R.str(d)));
  sdef('activate', (cls, args) => activateGem(jstr(args[0]), args[1] != null ? jstr(args[1]) : null, { skipStdlibShadow: true }));
  sdef('find_gem_dir', (cls, args) => {
    if (!gemIndex) buildGemIndex();
    const list = gemIndex.get(jstr(args[0]));
    if (!list) return null;
    if (args[1] != null) { const e = list.find((x) => x.version === jstr(args[1])); if (e) return R.str(e.dir); }
    return R.str(list[0].dir);
  });
  sdef('installed?', (cls, args) => { if (!gemIndex) buildGemIndex(); return gemIndex.has(jstr(args[0])); });
  sdef('list', () => { if (!gemIndex) buildGemIndex(); return [...gemIndex.keys()].sort().map((n) => R.str(n)); });
  sdef('loaded_specs', () => new R.RHash());
  sdef('ruby', () => R.str(process.execPath));
  sdef('win_platform?', () => false);
  GemM.constants.set('VERSION', R.str('3.5.0'));

  // Preload the rubygems shim (Gem::Version etc.) if present, like MRI does.
  try {
    if (fs.existsSync(join(STDLIB_DIR, 'rubygems.rb'))) requireFeature('rubygems');
  } catch { /* shim is optional */ }
}

export function runAtExit() {
  const hooks = R.__atexit;
  while (hooks.length) {
    const blk = hooks.pop();
    try { R.callBlock(blk, []); } catch { /* swallow at_exit errors like a dying VM */ }
  }
}
