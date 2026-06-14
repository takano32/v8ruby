// Runtime: the Ruby object model and core-class method tables, implemented in
// JavaScript and executed by V8. Compiled Ruby code calls into the single
// exported `R` object (R.send, R.truthy, R.str, …).

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { homedir } from 'node:os';
//
// Value representation:
//   nil     -> JS null
//   true/false -> JS boolean
//   Integer -> JS number (integer-valued)
//   Float   -> RFloat { value }
//   String  -> RString { value }   (mutable)
//   Symbol  -> RSymbol { name }    (interned)
//   Array   -> JS Array
//   Hash    -> RHash
//   Range   -> RRange
//   Proc    -> RProc
//   objects -> RObject { rclass, ivars }
//   classes -> RClass

// ---- core value classes ---------------------------------------------------
class RFloat { constructor(v) { this.value = v; } }
class RRational { constructor(num, den) { this.num = num; this.den = den; } }
class RComplex { constructor(re, im) { this.re = re; this.im = im; } }
class RString { constructor(s) { this.value = s; } }
class RSymbol { constructor(name) { this.name = name; } }
class RRange { constructor(from, to, exclusive) { this.from = from; this.to = to; this.exclusive = exclusive; } }
class RProc {
  constructor(fn, isLambda) { this.fn = fn; this.isLambda = !!isLambda; }
}
// A (possibly infinite) lazy enumerator. genFn is a JS generator function
// yielding Ruby values; pairs are yielded as JS arrays.
class REnumerator {
  constructor(genFn) { this.genFn = genFn; this._iter = null; this._lazy = false; }
  *[Symbol.iterator]() { yield* this.genFn(); }
}
class RRegexp {
  constructor(source, flags) {
    this.source = source;
    this.rflags = flags || '';
    const conv = convertRegexSource(source, this.rflags);
    this.re = new RegExp(conv.src, conv.flags);
  }
}
class RObject {
  constructor(rclass) { this.rclass = rclass; this.ivars = Object.create(null); }
}

// Translate a Ruby regex source+flags to a JS RegExp.
const POSIX_CLASS = {
  alpha: 'A-Za-z', digit: '\\d', alnum: 'A-Za-z\\d', space: '\\s',
  upper: 'A-Z', lower: 'a-z', xdigit: '0-9A-Fa-f', punct: '!-/:-@\\[-`{-~',
  blank: ' \\t', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e',
  word: '\\w',
};
function convertRegexSource(source, rflags) {
  // Ruby's ^ and $ are ALWAYS line-anchored (like JS /m); \A and \z are the
  // string anchors. So always compile with JS /m, and translate \A/\z to the
  // string-anchored forms that survive /m.
  let flags = 'm';
  if (rflags.includes('i')) flags += 'i';
  if (rflags.includes('m')) flags += 's'; // Ruby /m = dot matches newline = JS /s
  let src = source
    // \A → start of string (not line): (?<![\s\S]) ; \z → end of string: (?![\s\S])
    .replace(/\\A/g, '(?<![\\s\\S])').replace(/\\z/g, '(?![\\s\\S])')
    .replace(/\\Z/g, '(?![\\s\\S])')
    .replace(/\\h/g, '[0-9a-fA-F]').replace(/\\H/g, '[^0-9a-fA-F]')
    .replace(/\\e/g, '\\x1b') // JS regexes have no \e escape
    // Atomic groups (?>...) → non-capturing (?:...) (JS has no atomic groups;
    // the match set is the same, only backtracking behavior differs).
    .replace(/\(\?>/g, '(?:')
    // Possessive quantifiers X*+ X++ X?+ X{n,m}+ → greedy (JS has no possessive)
    .replace(/([*+?])\+/g, '$1')
    .replace(/(\{\d+(?:,\d*)?\})\+/g, '$1')
    // POSIX character classes: [[:alpha:]] → [A-Za-z], [^[:digit:]] → [^\d]
    .replace(/\[(\^?)\[:(\w+):\]\]/g, (_, neg, cls) => {
      const exp = POSIX_CLASS[cls];
      return exp ? `[${neg}${exp}]` : `[${neg}[:${cls}:]]`;
    })
    // POSIX inside a larger bracket expression: [a-z[:upper:]] → [a-zA-Z]
    .replace(/\[:(\w+):\]/g, (m, cls) => POSIX_CLASS[cls] || m)
    // Ruby inline flag groups (?on-off:...) — map Ruby flags to JS (m→s, drop x).
    // JS supports inline i and s; m (multiline) and x (extended) are not flags here.
    .replace(/\(\?([mix]*)(?:-([mix]*))?:/g, (whole, on, off) => {
      const map = (fs) => (fs || '').replace(/m/g, 's').replace(/x/g, '');
      const jsOn = map(on), jsOff = map(off);
      if (!jsOn && !jsOff) return '(?:';
      return `(?${jsOn}${jsOff ? '-' + jsOff : ''}:`;
    });
  if (rflags.includes('x')) {
    src = src.replace(/\\?\s|#.*$/gm, (m) => (m[0] === '\\' ? m : ''));
  }
  let f = flags + 'd';
  try { new RegExp(src, f); } catch { f = flags; try { new RegExp(src, f); } catch { src = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } }
  return { src, flags: f };
}
class RClass {
  constructor(name, superclass, isModule = false) {
    this.name = name;
    this.superclass = superclass || null;
    this.isModule = isModule;
    this.methods = new Map();
    this.smethods = new Map();   // singleton (class) methods
    this.constants = new Map();
    this.includes = [];          // included modules
    this.cvars = Object.create(null);
    this.ivars = Object.create(null);
  }
}

// Hash with arbitrary-key equality, preserving insertion order.
class RHash {
  constructor() { this.map = new Map(); this.defaultValue = null; this.defaultProc = null; }
  // map: canonicalKey -> { key, value }
  set(k, v) { this.map.set(hashKey(k), { key: k, value: v }); return v; }
  get(k) { const e = this.map.get(hashKey(k)); return e ? e.value : undefined; }
  has(k) { return this.map.has(hashKey(k)); }
  delete(k) { const kk = hashKey(k); const e = this.map.get(kk); this.map.delete(kk); return e ? e.value : null; }
  get size() { return this.map.size; }
  *entries() { for (const e of this.map.values()) yield [e.key, e.value]; }
  keys() { return [...this.map.values()].map((e) => e.key); }
  values() { return [...this.map.values()].map((e) => e.value); }
}

// Non-local control-flow signals.
class BreakError { constructor(value) { this.value = value; } }
class NextError { constructor(value) { this.value = value; } }
// frame identifies the method/lambda invocation a `return` targets, so a block's
// `return` unwinds to the method where the block was defined (not the yielder).
class ReturnError { constructor(value, frame = null) { this.value = value; this.frame = frame; } }
let frameCounter = 0;
function nextFrame() { return ++frameCounter; }
class RedoError {}
class RetryError {}
class ThrowSignal { constructor(tag, value) { this.tag = tag; this.value = value; } }
class StopIterationSignal { constructor(value) { this.value = value; } }
// A thrown Ruby exception object.
class RubyError extends Error {
  constructor(rubyObj) { super('RubyError'); this.rubyObj = rubyObj; }
}

// Canonical key for hashing/equality.
function hashKey(k) {
  if (k === null) return 'nil';
  if (k === true) return 'true';
  if (k === false) return 'false';
  if (typeof k === 'number') return 'i:' + k;
  if (k instanceof RFloat) return 'f:' + k.value;
  if (k instanceof RString) return 's:' + k.value;
  if (k instanceof RSymbol) return 'y:' + k.name;
  if (Array.isArray(k)) return 'a:[' + k.map(hashKey).join(',') + ']';
  if (k instanceof RObject) {
    // honor user-defined hash/eql? minimally via object identity fallback
    return 'o:' + objectId(k);
  }
  return 'x:' + String(k);
}

let OID = 1;
const oidMap = new WeakMap();
function objectId(o) {
  if (typeof o !== 'object' || o === null) {
    if (typeof o === 'number') return o * 2 + 1;
    if (o === null) return 8;
    if (o === true) return 20;
    if (o === false) return 0;
    return 0;
  }
  let id = oidMap.get(o);
  if (!id) { id = (OID += 1); oidMap.set(o, id); }
  return id;
}

// ---- class registry -------------------------------------------------------
const consts = new Map();          // global constants (class names, top-level consts)
const gvars = Object.create(null); // global variables
const GVAR_ALIAS = {
  '$:': '$LOAD_PATH', '$-I': '$LOAD_PATH',
  '$"': '$LOADED_FEATURES',
  '$0': '$PROGRAM_NAME',
};
// Registered autoloads: const name -> feature path; triggered on first lookup.
const autoloads = new Map();

function defClass(name, superclass, isModule = false) {
  const c = new RClass(name, superclass, isModule);
  consts.set(name, c);
  return c;
}

// Bootstrap the core hierarchy.
const BasicObjectC = defClass('BasicObject', null);
const ObjectC = defClass('Object', BasicObjectC);
const ModuleC = defClass('Module', ObjectC);
const ClassC = defClass('Class', ModuleC);
const KernelC = defClass('Kernel', null, true);
const ComparableC = defClass('Comparable', null, true);
const EnumerableC = defClass('Enumerable', null, true);
ObjectC.includes.push(KernelC);

const NumericC = defClass('Numeric', ObjectC);
const IntegerC = defClass('Integer', NumericC);
const FloatC = defClass('Float', NumericC);
const RationalC = defClass('Rational', NumericC);
const ComplexC = defClass('Complex', NumericC);
const StringC = defClass('String', ObjectC);
const SymbolC = defClass('Symbol', ObjectC);
const ArrayC = defClass('Array', ObjectC);
const HashC = defClass('Hash', ObjectC);
const RangeC = defClass('Range', ObjectC);
const ProcC = defClass('Proc', ObjectC);
const NilClassC = defClass('NilClass', ObjectC);
const TrueClassC = defClass('TrueClass', ObjectC);
const FalseClassC = defClass('FalseClass', ObjectC);
const MathM = defClass('Math', null, true);
const EnumeratorC = defClass('Enumerator', ObjectC);
const LazyC = defClass('Enumerator::Lazy', EnumeratorC);
EnumeratorC.includes.push(EnumerableC);
const StructC = defClass('Struct', ObjectC);
const RegexpC = defClass('Regexp', ObjectC);
const MatchDataC = defClass('MatchData', ObjectC);
NumericC.includes.push(ComparableC);
StringC.includes.push(ComparableC);
ArrayC.includes.push(EnumerableC);
HashC.includes.push(EnumerableC);
RangeC.includes.push(EnumerableC);

// Exception hierarchy.
const ExceptionC = defClass('Exception', ObjectC);
const ScriptErrorC = defClass('ScriptError', ExceptionC);
const LoadErrorC = defClass('LoadError', ScriptErrorC);
const SyntaxErrorC = defClass('SyntaxError', ScriptErrorC);
const StandardErrorC = defClass('StandardError', ExceptionC);
const RuntimeErrorC = defClass('RuntimeError', StandardErrorC);
const ArgumentErrorC = defClass('ArgumentError', StandardErrorC);
const TypeErrorC = defClass('TypeError', StandardErrorC);
const NameErrorC = defClass('NameError', StandardErrorC);
const NoMethodErrorC = defClass('NoMethodError', NameErrorC);
const IndexErrorC = defClass('IndexError', StandardErrorC);
const KeyErrorC = defClass('KeyError', IndexErrorC);
const RangeErrorC = defClass('RangeError', StandardErrorC);
const ZeroDivisionErrorC = defClass('ZeroDivisionError', StandardErrorC);
const StopIterationC = defClass('StopIteration', IndexErrorC);
const NotImplementedErrorC = defClass('NotImplementedError', ScriptErrorC);
const IOErrorC = defClass('IOError', StandardErrorC);
const FrozenErrorC = defClass('FrozenError', RuntimeErrorC);
const NoMatchingPatternErrorC = defClass('NoMatchingPatternError', StandardErrorC);

const mainObject = new RObject(ObjectC);

// The "current definee": the class that `def` adds methods to. A runtime stack
// (not lexical) so that class bodies, class_eval, and Struct.new blocks all
// target the right class. Top-level defs land on Object.
const defineeStack = [ObjectC];
function currentDefinee() { return defineeStack[defineeStack.length - 1]; }
function pushDefinee(c) { defineeStack.push(c); }
function popDefinee() { return defineeStack.pop(); }

// ---- class-of and method lookup ------------------------------------------
function classOf(v) {
  if (v === null || v === undefined) return NilClassC;
  if (v === true) return TrueClassC;
  if (v === false) return FalseClassC;
  const t = typeof v;
  if (t === 'number') return IntegerC;
  if (v instanceof RFloat) return FloatC;
  if (v instanceof RRational) return RationalC;
  if (v instanceof RComplex) return ComplexC;
  if (v instanceof RString) return v.rclass || StringC; // String subclasses
  if (v instanceof RSymbol) return SymbolC;
  if (Array.isArray(v)) return v.rclass || ArrayC;      // Array subclasses
  if (v instanceof RHash) return v.rclass || HashC;     // Hash subclasses
  if (v instanceof RRange) return RangeC;
  if (v instanceof RProc) return ProcC;
  if (v instanceof REnumerator) return v._lazy ? LazyC : EnumeratorC;
  if (v instanceof RRegexp) return RegexpC;
  if (v instanceof RClass) return v.isModule ? ModuleC : ClassC;
  if (v instanceof RObject) return v.rclass;
  return ObjectC;
}

function findMethod(cls, name) {
  let c = cls;
  while (c) {
    if (c.methods.has(name)) return c.methods.get(name);
    // included modules, last-included wins (search in reverse)
    for (let i = c.includes.length - 1; i >= 0; i--) {
      const m = findInModule(c.includes[i], name);
      if (m) return m;
    }
    c = c.superclass;
  }
  return null;
}
function findInModule(mod, name) {
  if (mod.methods.has(name)) return mod.methods.get(name);
  for (let i = mod.includes.length - 1; i >= 0; i--) {
    const m = findInModule(mod.includes[i], name);
    if (m) return m;
  }
  return null;
}

function findSingletonMethod(cls, name) {
  let c = cls;
  while (c) {
    if (c.smethods.has(name)) return c.smethods.get(name);
    c = c.superclass;
  }
  return null;
}

// ---- the central dispatch -------------------------------------------------
function send(recv, name, args = [], block = null) {
  // class / module receiver: singleton methods first
  if (recv instanceof RClass) {
    const sm = findSingletonMethod(recv, name);
    if (sm) return sm(recv, args, block);
    // `extend`ed modules: their instance methods act as singleton methods
    let c = recv;
    while (c) {
      if (c.ext) {
        for (let i = c.ext.length - 1; i >= 0; i--) {
          const em = findInModule(c.ext[i], name);
          if (em) return em(recv, args, block);
        }
      }
      c = c.superclass;
    }
    if (name === 'new') return classNew(recv, args, block);
    // module functions live in smethods too; fall through to Module/Class methods
    const m = findMethod(classOf(recv), name);
    if (m) return m(recv, args, block);
    return methodMissing(recv, name, args, block);
  }
  // per-object singleton methods and extended modules
  if (recv instanceof RObject) {
    if (recv.smeth && recv.smeth.has(name)) return recv.smeth.get(name)(recv, args, block);
    if (recv.ext) {
      for (let i = recv.ext.length - 1; i >= 0; i--) {
        const em = findInModule(recv.ext[i], name);
        if (em) return em(recv, args, block);
      }
    }
  }
  const m = findMethod(classOf(recv), name);
  if (m) return m(recv, args, block);
  return methodMissing(recv, name, args, block);
}

function methodMissing(recv, name, args, block) {
  const mm = findMethod(classOf(recv), 'method_missing');
  if (mm && mm !== OBJECT_METHOD_MISSING) {
    return mm(recv, [new RSymbol(name), ...args], block);
  }
  raiseError(NoMethodErrorC, `undefined method '${name}' for ${shortInspect(recv)}`);
}

function classNew(cls, args, block) {
  const obj = new RObject(cls);
  const init = findMethod(cls, 'initialize');
  if (init) init(obj, args, block);
  return obj;
}

function respondTo(recv, name) {
  if (recv instanceof RClass) {
    if (findSingletonMethod(recv, name) || name === 'new' || findMethod(classOf(recv), name)) return true;
    let c = recv;
    while (c) { if (c.ext && c.ext.some((m) => findInModule(m, name))) return true; c = c.superclass; }
    return false;
  }
  if (recv instanceof RObject && recv.ext && recv.ext.some((m) => findInModule(m, name))) return true;
  if (findMethod(classOf(recv), name)) return true;
  const rtm = findMethod(classOf(recv), 'respond_to_missing?');
  if (rtm && rtm !== DEFAULT_RTM) return truthy(rtm(recv, [new RSymbol(name), false]));
  return false;
}
let DEFAULT_RTM = null; // captured after Kernel install

// ---- block / proc helpers -------------------------------------------------
function makeProc(fn, isLambda) { return new RProc(fn, isLambda); }
function mkEnum(genFn) { return new REnumerator(genFn); }

function callBlock(block, args, self) {
  if (block === null || block === undefined) {
    raiseError(defConst('LocalJumpError', StandardErrorC), 'no block given (yield)');
  }
  if (block instanceof RProc) return block.fn(args, self);
  if (typeof block === 'function') return block(args, self);
  // a symbol used as block via &:sym handled by toProc
  raiseError(TypeErrorC, 'not a block');
}

function defConst(name, sup) {
  if (consts.has(name)) return consts.get(name);
  return defClass(name, sup);
}

function toProc(v) {
  if (v === null) return null;
  if (v instanceof RProc) return v;
  if (v instanceof RSymbol) {
    return makeProc((args) => send(args[0], v.name, args.slice(1)));
  }
  if (respondTo(v, 'to_proc')) return send(v, 'to_proc', []);
  raiseError(TypeErrorC, 'no implicit conversion to Proc');
}

// ---- truthiness & equality ------------------------------------------------
function truthy(v) { return v !== null && v !== false && v !== undefined; }

function rbEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (isNum(a) && isNum(b)) return numVal(a) === numVal(b);
  if (a instanceof RString && b instanceof RString) return a.value === b.value;
  if (a instanceof RSymbol && b instanceof RSymbol) return a.name === b.name;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!rbEqual(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof RHash && b instanceof RHash) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a.entries()) { if (!b.has(k) || !rbEqual(b.get(k), v)) return false; }
    return true;
  }
  if (a instanceof RRange && b instanceof RRange) {
    return rbEqual(a.from, b.from) && rbEqual(a.to, b.to) && a.exclusive === b.exclusive;
  }
  if (a instanceof RObject) {
    const m = findMethod(a.rclass, '==');
    if (m && m !== OBJECT_EQ) return truthy(m(a, [b]));
  }
  return false;
}

function isNum(v) { return typeof v === 'number' || v instanceof RFloat; }
function numVal(v) { return typeof v === 'number' ? v : (v instanceof RRational ? v.num / v.den : v.value); }
function isInt(v) { return typeof v === 'number'; }
function mkfloat(v) { return new RFloat(v); }

// ---- to_s / inspect -------------------------------------------------------
// Ruby's Regexp#to_s: (?on-off:source) with flags ordered m,i,x — used when a
// Regexp is interpolated into another regex or a string.
function regexpToS(s) {
  const fl = s.rflags || '';
  const on = ['m', 'i', 'x'].filter((f) => fl.includes(f)).join('');
  const off = ['m', 'i', 'x'].filter((f) => !fl.includes(f)).join('');
  return `(?${on}-${off}:${s.source})`;
}

function toS(v) {
  // returns a JS string
  if (v === null || v === undefined) return '';
  if (v instanceof RRegexp) return regexpToS(v);
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return String(v);
  if (v instanceof RFloat) return floatToS(v.value);
  if (v instanceof RRational) return ratToS(v);
  if (v instanceof RComplex) return cplxToS(v, false);
  if (v instanceof RString) return v.value;
  if (v instanceof RSymbol) return v.name;
  if (Array.isArray(v)) return inspect(v);
  if (v instanceof RHash) return inspect(v);
  if (v instanceof RRange) return toS(v.from) + (v.exclusive ? '...' : '..') + toS(v.to);
  if (v instanceof RProc) return '#<Proc>';
  if (v instanceof RClass) return v.name;
  if (v instanceof RObject) {
    const m = findMethod(v.rclass, 'to_s');
    if (m && m !== OBJECT_TO_S) return jsstr(m(v, []));
    return `#<${v.rclass.name}>`;
  }
  return String(v);
}

function floatToS(n) {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-4)) {
    // Use scientific notation matching MRI format: sign + digits + e+/-NN (2-digit exp)
    let s = n.toExponential();
    // toExponential gives e.g. "1e+15", "1.23e-5" — normalize exponent to 2 digits with sign
    s = s.replace(/e([+-])(\d)$/, 'e$10$2');
    // Ensure there's a decimal point: "1e+15" → "1.0e+15"
    s = s.replace(/^(-?\d+)(e)/, '$1.0$2');
    return s;
  }
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

function inspect(v) {
  if (v === null || v === undefined) return 'nil';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return String(v);
  if (v instanceof RFloat) return floatToS(v.value);
  if (v instanceof RRational) return `(${ratToS(v)})`;
  if (v instanceof RComplex) return cplxToS(v, true);
  if (v instanceof RString) return strInspect(v.value);
  if (v instanceof RSymbol) {
    // bare identifiers, operators, and `name=`/`name?`/`name!` print unquoted;
    // anything else (spaces, etc.) is quoted like a string
    const n = v.name;
    const bare = /^[a-zA-Z_]\w*[?!=]?$/.test(n) || /^@{0,2}[a-zA-Z_]\w*$/.test(n) ||
      /^\$[a-zA-Z_]\w*$/.test(n) || /^(\[\]=?|[+\-*/%<>=!~&|^]+|<=>|===?|!=|<=|>=|<<|>>|\*\*)$/.test(n);
    return bare ? ':' + n : ':' + strInspect(n);
  }
  if (Array.isArray(v)) return '[' + v.map(inspect).join(', ') + ']';
  if (v instanceof RHash) {
    const parts = [];
    for (const [k, val] of v.entries()) {
      if (k instanceof RSymbol) parts.push(`${k.name}: ${inspect(val)}`);
      else parts.push(`${inspect(k)} => ${inspect(val)}`);
    }
    return '{' + parts.join(', ') + '}';
  }
  if (v instanceof RRange) return inspect(v.from) + (v.exclusive ? '...' : '..') + inspect(v.to);
  if (v instanceof RProc) return '#<Proc' + (v.isLambda ? ' (lambda)' : '') + '>';
  if (v instanceof RClass) return v.name;
  if (v instanceof RObject) {
    const m = findMethod(v.rclass, 'inspect');
    if (m && m !== OBJECT_INSPECT) return jsstr(m(v, []));
    const ivars = Object.keys(v.ivars);
    if (ivars.length === 0) return `#<${v.rclass.name}>`;
    const parts = ivars.map((k) => `${k}=${inspect(v.ivars[k])}`);
    return `#<${v.rclass.name} ${parts.join(', ')}>`;
  }
  return String(v);
}

const STR_NAMED_ESC = { 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 27: '\\e' };
function strInspect(s) {
  const chars = [...s];
  let out = '"';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]; const cp = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '#' && (chars[i + 1] === '{' || chars[i + 1] === '$' || chars[i + 1] === '@')) out += '\\#';
    else if (STR_NAMED_ESC[cp]) out += STR_NAMED_ESC[cp];
    else if (cp < 0x20 || cp === 0x7f) out += '\\u' + cp.toString(16).toUpperCase().padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function shortInspect(v) {
  const c = classOf(v);
  if (v instanceof RObject) return `an instance of ${c.name}`;
  return inspect(v);
}

function jsstr(v) { return v instanceof RString ? v.value : toS(v); }

// ---- comparison helper ----------------------------------------------------
function spaceship(a, b) {
  if (isNum(a) && isNum(b)) { const x = numVal(a), y = numVal(b); return x < y ? -1 : x > y ? 1 : 0; }
  if (a instanceof RString && b instanceof RString) return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  if (a instanceof RSymbol && b instanceof RSymbol) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const c = spaceship(a[i], b[i]); if (c !== 0) return c; }
    return a.length - b.length === 0 ? 0 : (a.length < b.length ? -1 : 1);
  }
  const r = send(a, '<=>', [b]);
  if (r === null) raiseError(ArgumentErrorC, `comparison failed`);
  return numVal(r);
}

// ---- exceptions -----------------------------------------------------------
function raiseError(cls, message) {
  const obj = new RObject(cls);
  obj.ivars['@message'] = new RString(message);
  throw new RubyError(obj);
}
function excMessage(obj) {
  if (obj instanceof RObject && obj.ivars['@message'] != null) return jsstr(obj.ivars['@message']);
  return classOf(obj).name;
}

// ---- string formatting (sprintf subset) ----------------------------------
function sprintf(fmt, args) {
  let i = 0;
  return fmt.replace(/%([#0\- +]*)(\d+)?(?:\.(\d+))?([sdifgGeExXobc%])/g,
    (m, flags, width, prec, conv) => {
      if (conv === '%') return '%';
      let arg = args[i++];
      let s;
      switch (conv) {
        case 'd': case 'i': s = String(Math.trunc(numVal(arg))); break;
        case 'f': s = numVal(arg).toFixed(prec === undefined ? 6 : +prec); break;
        case 'e': s = numVal(arg).toExponential(prec === undefined ? 6 : +prec).replace(/e([+-])(\d)$/, 'e$10$2'); break;
        case 'g': case 'G': {
          let p = prec === undefined ? 6 : +prec; if (p === 0) p = 1;
          const v = numVal(arg);
          if (v === 0) { s = '0'; }
          else {
            const exp = parseInt(v.toExponential().split('e')[1], 10);
            if (exp < -4 || exp >= p) {
              s = v.toExponential(p - 1).replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2');
            } else {
              s = v.toFixed(Math.max(0, p - 1 - exp));
              if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
            }
          }
          if (conv === 'G') s = s.toUpperCase();
          break;
        }
        case 's': s = toS(arg); if (prec !== undefined) s = s.slice(0, +prec); break;
        case 'x': s = Math.trunc(numVal(arg)).toString(16); break;
        case 'X': s = Math.trunc(numVal(arg)).toString(16).toUpperCase(); break;
        case 'o': s = Math.trunc(numVal(arg)).toString(8); break;
        case 'b': s = Math.trunc(numVal(arg)).toString(2); break;
        case 'c': s = typeof arg === 'number' ? String.fromCharCode(arg) : toS(arg); break;
        default: s = toS(arg);
      }
      const neg = s.startsWith('-');
      if (flags.includes('+') && !neg && 'difeEgG'.includes(conv)) s = '+' + s;
      else if (flags.includes(' ') && !neg && 'difeEgG'.includes(conv)) s = ' ' + s;
      if (width) {
        const w = +width;
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && !flags.includes('-')) {
          if (neg) s = '-' + s.slice(1).padStart(w - 1, '0');
          else s = s.padStart(w, '0');
        } else s = s.padStart(w);
      }
      return s;
    });
}

// ---- method definition helpers -------------------------------------------
function def(cls, name, fn) { cls.methods.set(name, fn); }
function sdef(cls, name, fn) { cls.smethods.set(name, fn); }

// Convenience: arg access with defaults.
const arg = (args, i, d = null) => (i < args.length ? args[i] : d);

// Placeholders captured after definition for identity checks.
let OBJECT_TO_S, OBJECT_INSPECT, OBJECT_EQ, OBJECT_METHOD_MISSING;

// The public runtime object compiled code talks to.
const R = {
  // constructors / literals
  RFloat, RString, RSymbol, RRange, RProc, RObject, RClass, RHash,
  nil: null,
  float: (v) => new RFloat(v),
  rational: (n, d) => mkRational(n, d),
  complex: (re, im) => mkComplex(re, im),
  str: (s) => new RString(s),
  sym: (() => { const tbl = new Map(); return (n) => { let s = tbl.get(n); if (!s) { s = new RSymbol(n); tbl.set(n, s); } return s; }; })(),
  range: (from, to, excl) => new RRange(from, to, excl),
  regexp: (src, flags) => new RRegexp(src instanceof RString ? src.value : String(src), flags),
  RRegexp,
  hash: (pairs) => { const h = new RHash(); for (const [k, v] of pairs) h.set(k, v); return h; },
  hashMerge: (h, ...others) => { for (const o of others) { if (o instanceof RHash) for (const [k, v] of o.entries()) h.set(k, v); } return h; },
  array: (a) => a,
  splat: (v) => toArray(v),
  main: mainObject,
  patMatch: (value, d) => { const binds = {}; return patMatch(value, d, binds) ? binds : false; },
  raisePatternError: (value) => raiseError(NoMatchingPatternErrorC, inspect(value)),

  // dispatch & control
  send, callBlock, makeProc, toProc, truthy, respondTo,
  yieldSelf: null,
  classOf,
  isA: (v, cls) => isA(v, cls),

  // interpolation / output
  interp: (v) => toS(v),
  toS, inspect,

  // exceptions
  RubyError, BreakError, NextError, ReturnError, RedoError, RetryError, ThrowSignal, StopIterationSignal,
  nextFrame,
  raise: rbRaise,
  raiseError,

  // variable helpers
  ivarGet: (self, name) => (self instanceof RObject || self instanceof RClass ? (self.ivars[name] ?? null) : null),
  ivarSet: (self, name, v) => { if (self instanceof RObject || self instanceof RClass) self.ivars[name] = v; return v; },
  gvarGet: (name) => {
    name = GVAR_ALIAS[name] || name;
    if (name.length === 2 && name[1] >= '1' && name[1] <= '9') {
      const md = gvars['$~'];
      return md ? send(md, '[]', [+name[1]]) : null;
    }
    return gvars[name] ?? null;
  },
  gvarSet: (name, v) => { gvars[GVAR_ALIAS[name] || name] = v; return v; },
  cvarGet, cvarSet,
  constGet, constSet, constGetFrom, constLookup, constResolve, constDefined,
  autoloads,

  // loader hooks (set by src/loader.js)
  __require: null,
  __atexit: [],
  currentFile: () => new RString('(eval)'),

  // class building (used by compiled class/module/def)
  defineClass, defineModule, defineMethod, defineSMethod, includeModule,
  defineAttr, openSingleton, defineSingletonClass, aliasSingleton,
  currentDefinee, pushDefinee, popDefinee,

  // operators that need centralizing
  and: (l, rf) => (truthy(l) ? rf() : l),
  or: (l, rf) => (truthy(l) ? l : rf()),
  not: (v) => !truthy(v),

  // destructuring for multiple assignment
  destructure,
  toArray,

  // super
  superCall,
  wrapJsError: (e) => {
    if (e instanceof RubyError) return e.rubyObj;
    const cls = (e instanceof RangeError) ? defConst('SystemStackError', ExceptionC)
      : (e instanceof TypeError) ? TypeErrorC : StandardErrorC;
    return mkExc(cls, e && e.message ? String(e.message) : String(e));
  },

  // misc
  rbEqual, spaceship, sprintf,
  consts,
  classes: { ObjectC, IntegerC, FloatC, StringC, ArrayC, HashC },
  blockGiven: (b) => b !== null && b !== undefined,
  Comparable: ComparableC,
  Enumerable: EnumerableC,
};

function isA(v, cls) {
  if (!(cls instanceof RClass)) return false;
  let c = classOf(v);
  while (c) {
    if (c === cls) return true;
    if (c.includes.some((m) => moduleIncludes(m, cls))) return true;
    c = c.superclass;
  }
  return false;
}
function moduleIncludes(mod, cls) {
  if (mod === cls) return true;
  return mod.includes.some((m) => moduleIncludes(m, cls));
}

function superCall(self, cls, name, args, block) {
  // For singleton (class) methods, search the superclass singleton chain.
  if (self instanceof RClass && cls) {
    const sm = cls.superclass ? findSingletonMethod(cls.superclass, name) : null;
    if (sm) return sm(self, args, block);
    // `def self.new ... super` bottoms out at the default allocator
    if (name === 'new') return classNew(self, args, block);
  }
  const start = cls ? cls.superclass : (classOf(self).superclass);
  const m = start ? findMethod(start, name) : null;
  if (!m) raiseError(NoMethodErrorC, `super: no superclass method '${name}' for ${shortInspect(self)}`);
  return m(self, args, block);
}

function rbRaise(arg1, arg2) {
  // raise                       -> re-raise / RuntimeError
  // raise "msg"                 -> RuntimeError.new("msg")
  // raise SomeError             -> SomeError.new
  // raise SomeError, "msg"      -> SomeError.new("msg")
  // raise <exception instance>  -> throw it
  if (arg1 === undefined || arg1 === null) {
    // bare `raise` re-raises the exception currently being handled ($!)
    const cur = gvars['$!'];
    if (cur != null) throw new RubyError(cur);
    raiseError(RuntimeErrorC, 'unhandled exception');
  }
  if (arg1 instanceof RString) raiseError(RuntimeErrorC, arg1.value);
  if (arg1 instanceof RClass) {
    const obj = new RObject(arg1);
    const msg = arg2 != null ? arg2 : new RString(arg1.name);
    const init = findMethod(arg1, 'initialize');
    if (init) init(obj, [msg]);
    else obj.ivars['@message'] = msg instanceof RString ? msg : new RString(toS(msg));
    if (obj.ivars['@message'] == null) obj.ivars['@message'] = msg instanceof RString ? msg : new RString(toS(msg));
    throw new RubyError(obj);
  }
  if (arg1 instanceof RObject) throw new RubyError(arg1);
  raiseError(TypeErrorC, 'exception class/object expected');
}

function cvarGet(self, name) {
  const cls = self instanceof RClass ? self : classOf(self);
  let c = cls;
  while (c) { if (name in c.cvars) return c.cvars[name]; c = c.superclass; }
  return null;
}
function cvarSet(self, name, v) {
  const cls = self instanceof RClass ? self : classOf(self);
  cls.cvars[name] = v;
  return v;
}

function tryAutoload(name) {
  if (!autoloads.has(name) || !R.__require) return false;
  const path = autoloads.get(name);
  autoloads.delete(name);
  try { R.__require(jsstr(path)); } catch (e) { autoloads.set(name, path); throw e; }
  return true;
}

// Module-scoped autoload: `Foo.autoload :Bar, path` registers on Foo, not the
// global table, so two different modules can autoload the same constant name.
function tryAutoloadIn(mod, name) {
  if (!mod || !mod.autoloads || !mod.autoloads.has(name) || !R.__require) return false;
  const path = mod.autoloads.get(name);
  mod.autoloads.delete(name);
  try { R.__require(jsstr(path)); } catch (e) { mod.autoloads.set(name, path); throw e; }
  return true;
}

function constGet(name) {
  if (consts.has(name)) return consts.get(name);
  if (tryAutoload(name) && consts.has(name)) return consts.get(name);
  raiseError(NameErrorC, `uninitialized constant ${name}`);
}
function constSet(name, v) {
  const d = currentDefinee();
  if (d && d !== ObjectC) d.constants.set(name, v);
  else consts.set(name, v);
  if (v instanceof RClass && (v.name === null || v.name === undefined)) v.name = name;
  return v;
}
// Resolve a "Foo::Bar" path from the global root; null if any segment missing.
function resolvePath(path) {
  let cur = null;
  for (const seg of path.split('::')) {
    const tbl = cur === null ? consts : (cur instanceof RClass ? cur.constants : null);
    if (!tbl || !tbl.has(seg)) return null;
    cur = tbl.get(seg);
  }
  return cur instanceof RClass ? cur : null;
}
// Bare-constant lookup: lexical nesting (innermost first, as compile-time
// "Foo::Bar" paths), then the defining class's superclass chain, then globals,
// then autoload.
function constResolve(nesting, cls, name) {
  const search = () => {
    for (let i = nesting.length - 1; i >= 0; i--) {
      const mod = resolvePath(nesting[i]);
      if (mod) { const v = constInModule(mod, name); if (v !== undefined) return v; }
    }
    let c = cls instanceof RClass ? cls : null;
    while (c) {
      const v = constInModule(c, name);
      if (v !== undefined) return v;
      c = c.superclass;
    }
    if (consts.has(name)) return consts.get(name);
    return undefined;
  };
  let v = search();
  if (v !== undefined) return v;
  // A pending global autoload (top-level `autoload`) may define it.
  if (tryAutoload(name)) { v = search(); if (v !== undefined) return v; }
  return constGet(name);
}
// Back-compat single-arg form used by a few runtime call sites.
function constLookup(cls, name) {
  return constResolve([], cls, name);
}
function constDefined(nesting, cls, name) {
  for (let i = nesting.length - 1; i >= 0; i--) {
    const mod = resolvePath(nesting[i]);
    if (mod && (mod.constants.has(name) || (mod.autoloads && mod.autoloads.has(name)))) return true;
  }
  let c = cls instanceof RClass ? cls : null;
  while (c) {
    if (c.constants.has(name) || (c.autoloads && c.autoloads.has(name))) return true;
    c = c.superclass;
  }
  return consts.has(name) || autoloads.has(name);
}
// Look up a constant in a module and its included modules (recursively).
function constInModule(mod, name) {
  if (mod.constants.has(name)) return mod.constants.get(name);
  if (tryAutoloadIn(mod, name) && mod.constants.has(name)) return mod.constants.get(name);
  for (let i = mod.includes.length - 1; i >= 0; i--) {
    const v = constInModule(mod.includes[i], name);
    if (v !== undefined) return v;
  }
  return undefined;
}
function constGetFrom(base, name) {
  const search = () => {
    // qualified A::B searches A, A's included modules, then A's superclasses
    let c = base instanceof RClass ? base : null;
    while (c) {
      const v = constInModule(c, name);
      if (v !== undefined) return v;
      c = c.superclass;
    }
    if (consts.has(name)) return consts.get(name);
    return undefined;
  };
  let v = search();
  if (v !== undefined) return v;
  // A pending global autoload may define the constant.
  if (tryAutoload(name)) { v = search(); if (v !== undefined) return v; }
  raiseError(NameErrorC, `uninitialized constant ${base instanceof RClass && base.name ? base.name + '::' : ''}${name}`);
}

// `class A::B` / `module A::B`: resolve the qualified prefix as the outer scope.
function splitQualified(name, outer) {
  if (!name.includes('::')) return [name, outer];
  const parts = name.split('::');
  const last = parts.pop();
  let base = null;
  for (const p of parts) base = base ? constGetFrom(base, p) : constGet(p);
  return [last, base];
}

function defineClass(name, superExpr, builder, outer) {
  [name, outer] = splitQualified(name, outer);
  if (!outer) { const d = currentDefinee(); if (d && d !== ObjectC) outer = d; }
  // When nested in an outer module/class, a `class Name` only reopens
  // outer::Name — never a same-named top-level constant.
  let cls = outer ? (outer.constants.has(name) ? outer.constants.get(name) : null)
    : (consts.has(name) ? consts.get(name) : null);
  if (!cls) {
    cls = new RClass(name, superExpr || ObjectC);
    if (outer) {
      outer.constants.set(name, cls);
      if (outer.name) cls.name = outer.name + '::' + name;
    } else {
      consts.set(name, cls);
    }
    if (superExpr) {
      const inh = findSingletonMethod(superExpr, 'inherited');
      if (inh) inh(superExpr, [cls]);
    }
  }
  pushDefinee(cls);
  let r;
  try { r = builder(cls); } finally { popDefinee(); }
  return r === undefined ? null : r;
}
function defineModule(name, builder, outer) {
  [name, outer] = splitQualified(name, outer);
  if (!outer) { const d = currentDefinee(); if (d && d !== ObjectC) outer = d; }
  // Nested `module Name` only reopens outer::Name, never a top-level same-named const.
  let mod = outer ? (outer.constants.has(name) ? outer.constants.get(name) : null)
    : (consts.has(name) ? consts.get(name) : null);
  if (!mod) {
    mod = new RClass(name, null, true);
    if (outer) {
      outer.constants.set(name, mod);
      if (outer.name) mod.name = outer.name + '::' + name;
    } else {
      consts.set(name, mod);
    }
  }
  pushDefinee(mod);
  try { builder(mod); } finally { popDefinee(); }
  return null;
}
function aliasSingleton(target, newName, oldName) {
  if (target instanceof RClass) {
    const m = findSingletonMethod(target, oldName) ||
      (target.ext || []).map((mod) => findInModule(mod, oldName)).find(Boolean) ||
      target.methods.get(oldName);
    if (m) target.smethods.set(newName, m);
  }
  return null;
}

function defineMethod(cls, name, fn) {
  cls.methods.set(name, fn);
  // after a bare `module_function`, defs also become module functions
  if (cls.__modfunc) cls.smethods.set(name, fn);
  const hook = findSingletonMethod(cls, 'method_added');
  if (hook) hook(cls, [new RSymbol(name)]);
  return new RSymbol(name);
}
function defineSMethod(cls, name, fn) { cls.smethods.set(name, fn); return new RSymbol(name); }
function includeModule(cls, mod) { if (!cls.includes.includes(mod)) cls.includes.push(mod); const inc = findSingletonMethod(mod, 'included'); if (inc) inc(mod, [cls]); return cls; }
function openSingleton(obj, builder) {
  // class << obj : define singleton methods. We support obj being a class.
  if (obj instanceof RClass) builder({ defS: (n, fn) => obj.smethods.set(n, fn) });
  return null;
}

// Synthetic singleton class whose method table IS the object's singleton-method
// map, so a `def` anywhere in a `class << obj` body (even nested in if/case)
// targets it via the normal currentDefinee() mechanism.
function singletonClassOf(obj) {
  if (obj.__sclass) return obj.__sclass;
  const sc = new RClass('#<Class:' + (obj.name || 'obj') + '>', ClassC || null);
  sc.methods = obj instanceof RClass ? obj.smethods : (obj.smeth || (obj.smeth = new Map()));
  sc.__singletonOf = obj;
  obj.__sclass = sc;
  return sc;
}
function defineSingletonClass(obj, builder) {
  const sc = singletonClassOf(obj);
  pushDefinee(sc);
  try { const r = builder(sc); return r === undefined ? null : r; } finally { popDefinee(); }
}

function defineAttr(cls, kind, names, singleton = false) {
  const table = singleton ? cls.smethods : cls.methods;
  for (const name of names) {
    const iv = '@' + name;
    if (kind === 'attr_reader' || kind === 'attr_accessor') {
      table.set(name, (self) => (self.ivars[iv] ?? null));
    }
    if (kind === 'attr_writer' || kind === 'attr_accessor') {
      table.set(name + '=', (self, args) => { self.ivars[iv] = args[0]; return args[0]; });
    }
  }
  return null;
}

// Convert a Ruby value to a JS array (to_a semantics for splat/destructuring).
function toArray(v) {
  if (v === null) return [];
  if (Array.isArray(v)) return v;
  if (v instanceof RRange) return rangeToArray(v);
  if (v instanceof RHash) { const a = []; for (const [k, val] of v.entries()) a.push([k, val]); return a; }
  if (respondTo(v, 'to_a')) { const r = send(v, 'to_a', []); return Array.isArray(r) ? r : [v]; }
  return [v];
}

function rangeToArray(r) {
  const out = [];
  if (isInt(r.from) && (r.to === null || isInt(r.to))) {
    const end = r.exclusive ? r.to - 1 : r.to;
    for (let i = r.from; i <= end; i++) out.push(i);
  } else if (r.from instanceof RString && r.to instanceof RString) {
    let cur = r.from.value; const end = r.to.value;
    while (true) {
      if (r.exclusive && cur === end) break;
      out.push(new RString(cur));
      if (cur === end) break;
      cur = strSucc(cur);
      if (cur.length > end.length) break;
    }
  }
  return out;
}

function strSucc(s) {
  if (s === '') return '';
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    const c = arr[i];
    if (c >= '0' && c <= '8') { arr[i] = String.fromCharCode(c.charCodeAt(0) + 1); return arr.join(''); }
    if (c === '9') { arr[i] = '0'; i--; continue; }
    if (c >= 'a' && c <= 'y') { arr[i] = String.fromCharCode(c.charCodeAt(0) + 1); return arr.join(''); }
    if (c === 'z') { arr[i] = 'a'; i--; continue; }
    if (c >= 'A' && c <= 'Y') { arr[i] = String.fromCharCode(c.charCodeAt(0) + 1); return arr.join(''); }
    if (c === 'Z') { arr[i] = 'A'; i--; continue; }
    arr[i] = String.fromCharCode(c.charCodeAt(0) + 1); return arr.join('');
  }
  return s; // overflow handled by caller length check
}

// Multiple-assignment destructuring. targets: [{kind}], returns array of values.
function destructure(value, count, splatIndex) {
  const arr = Array.isArray(value) ? value : toArray(value);
  const result = [];
  if (splatIndex < 0) {
    for (let i = 0; i < count; i++) result.push(i < arr.length ? arr[i] : null);
    return result;
  }
  const before = splatIndex;
  const after = count - splatIndex - 1;
  for (let i = 0; i < before; i++) result.push(i < arr.length ? arr[i] : null);
  const splatLen = Math.max(0, arr.length - before - after);
  result.push(arr.slice(before, before + splatLen));
  for (let i = 0; i < after; i++) result.push(arr[before + splatLen + i] ?? null);
  return result;
}

// ============================================================================
// Core method tables.
// ============================================================================
installKernel();
installInteger();
installFloat();
installRational();
installComplex();
installNumeric();
installString();
installSymbol();
installArray();
installHash();
installRange();
installProc();
installNilTrueFalse();
installComparable();
installEnumerable();
installEnumerator();
installLazy();
installModuleClass();
installException();
installMath();
installStruct();
installRegexp();
installNodeCore();

OBJECT_TO_S = ObjectC.methods.get('to_s');
OBJECT_INSPECT = ObjectC.methods.get('inspect');
OBJECT_EQ = ObjectC.methods.get('==');
OBJECT_METHOD_MISSING = ObjectC.methods.get('method_missing');
DEFAULT_RTM = ObjectC.methods.get('respond_to_missing?');

// ---- Kernel / Object ------------------------------------------------------
function installKernel() {
  const out = (s) => process.stdout.write(s);
  def(ObjectC, 'puts', (self, args) => { putsImpl(args); return null; });
  def(ObjectC, 'print', (self, args) => { for (const a of args) out(toS(a)); return null; });
  def(ObjectC, 'p', (self, args) => {
    for (const a of args) out(inspect(a) + '\n');
    return args.length === 0 ? null : (args.length === 1 ? args[0] : args);
  });
  def(ObjectC, 'pp', ObjectC.methods.get('p'));
  def(ObjectC, 'require', () => false);
  def(ObjectC, 'require_relative', () => false);
  def(ObjectC, 'raise', (self, args) => rbRaise(args[0], args[1]));
  def(ObjectC, 'fail', (self, args) => rbRaise(args[0], args[1]));
  def(ObjectC, 'loop', (self, args, block) => {
    try { while (true) { try { callBlock(block, []); } catch (e) { if (e instanceof NextError) continue; throw e; } } }
    catch (e) {
      if (e instanceof BreakError) return e.value;
      if (e instanceof RubyError && isA(e.rubyObj, StopIterationC)) return null;
      throw e;
    }
  });
  def(ObjectC, 'lambda', (self, args, block) => { if (block) { block.isLambda = true; return block; } raiseError(ArgumentErrorC, 'tried to create Proc without a block'); });
  def(ObjectC, 'proc', (self, args, block) => block);
  def(ObjectC, 'block_given?', () => false); // replaced contextually by compiler
  def(ObjectC, 'rand', (self, args) => {
    const r = Math.random();
    if (args.length === 0) return mkfloat(r);
    const n = args[0];
    if (n instanceof RRange) { const lo = n.from, hi = n.to; return lo + Math.floor(r * (hi - lo + (n.exclusive ? 0 : 1))); }
    if (isInt(n)) return Math.floor(r * n);
    return mkfloat(r * numVal(n));
  });
  def(ObjectC, 'srand', () => 0);
  def(ObjectC, 'sleep', () => 0);
  def(ObjectC, 'exit', (self, args) => { throw new RubyError(mkExc(defConst('SystemExit', ExceptionC), 'exit')); });
  def(ObjectC, 'abort', (self, args) => { if (args[0]) process.stderr.write(toS(args[0]) + '\n'); throw new RubyError(mkExc(defConst('SystemExit', ExceptionC), 'exit')); });
  def(ObjectC, 'format', (self, args) => new RString(sprintf(jsstr(args[0]), args.slice(1))));
  def(ObjectC, 'sprintf', ObjectC.methods.get('format'));
  def(ObjectC, 'printf', (self, args) => { out(sprintf(jsstr(args[0]), args.slice(1))); return null; });
  def(ObjectC, 'Integer', (self, args) => {
    const v = args[0];
    if (isInt(v)) return v;
    if (v instanceof RFloat) return Math.trunc(v.value);
    if (v instanceof RString) { const base = args[1] ? numVal(args[1]) : 10; const n = parseInt(v.value.trim(), base); if (Number.isNaN(n)) raiseError(ArgumentErrorC, `invalid value for Integer(): "${v.value}"`); return n; }
    raiseError(TypeErrorC, "can't convert to Integer");
  });
  def(ObjectC, 'Float', (self, args) => {
    const v = args[0];
    if (isNum(v)) return mkfloat(numVal(v));
    if (v instanceof RString) { const n = parseFloat(v.value); if (Number.isNaN(n)) raiseError(ArgumentErrorC, `invalid value for Float(): "${v.value}"`); return mkfloat(n); }
    raiseError(TypeErrorC, "can't convert to Float");
  });
  def(ObjectC, 'Rational', (self, args) => {
    const n = args[0]; const d = args[1] != null ? args[1] : 1;
    if ((isInt(n) || n instanceof RRational) && (isInt(d) || d instanceof RRational)) { const rn = toRational(n), rd = toRational(d); return mkRational(rn.num * rd.den, rn.den * rd.num); }
    if (n instanceof RString && args[1] == null) { const m = n.value.trim().match(/^(-?\d+)(?:\/(\d+))?$/); if (m) return mkRational(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 1); raiseError(ArgumentErrorC, `invalid value for convert(): "${n.value}"`); }
    return floatToRational(numVal(n) / numVal(d));
  });
  def(ObjectC, 'Complex', (self, args) => mkComplex(args[0], args[1] != null ? args[1] : 0));
  def(ObjectC, 'String', (self, args) => new RString(toS(args[0])));
  def(ObjectC, 'Array', (self, args) => { const v = args[0]; if (v === null) return []; if (Array.isArray(v)) return v; return toArray(v); });
  def(ObjectC, 'gets', () => null);
  def(ObjectC, 'freeze', (self) => { if (self && typeof self === 'object') self.__frozen = true; return self; });
  def(ObjectC, 'frozen?', (self) => {
    if (self === null || self === true || self === false) return true;
    if (typeof self === 'number' || self instanceof RFloat || self instanceof RSymbol) return true;
    if (self && typeof self === 'object') return !!self.__frozen;
    return true;
  });
  def(ObjectC, 'dup', (self) => dupValue(self));
  def(ObjectC, 'clone', (self) => dupValue(self));
  def(ObjectC, 'tap', (self, args, block) => { callBlock(block, [self]); return self; });
  def(ObjectC, 'then', (self, args, block) => (block ? callBlock(block, [self]) : self));
  def(ObjectC, 'yield_self', ObjectC.methods.get('then'));
  def(ObjectC, 'itself', (self) => self);
  def(ObjectC, 'object_id', (self) => objectId(self));
  def(ObjectC, '__id__', (self) => objectId(self));
  def(ObjectC, 'hash', (self) => { const k = hashKey(self); let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; return h; });
  def(ObjectC, 'class', (self) => classOf(self));
  def(ObjectC, 'singleton_class', (self) => classOf(self));
  def(ObjectC, 'is_a?', (self, args) => isA(self, args[0]));
  def(ObjectC, 'kind_of?', ObjectC.methods.get('is_a?'));
  def(ObjectC, 'instance_of?', (self, args) => classOf(self) === args[0]);
  def(ObjectC, 'respond_to?', (self, args) => respondTo(self, args[0] instanceof RSymbol ? args[0].name : jsstr(args[0])));
  def(ObjectC, 'nil?', (self) => self === null);
  def(ObjectC, '==', (self, args) => rbEqual(self, args[0]));
  def(ObjectC, '!=', (self, args) => !truthy(send(self, '==', [args[0]])));
  def(ObjectC, 'equal?', (self, args) => self === args[0]);
  def(ObjectC, 'eql?', (self, args) => rbEqual(self, args[0]));
  def(ObjectC, '===', (self, args) => truthy(send(self, '==', [args[0]])));
  def(ObjectC, '!', (self) => !truthy(self));
  def(ObjectC, 'send', (self, args, block) => send(self, args[0] instanceof RSymbol ? args[0].name : jsstr(args[0]), args.slice(1), block));
  def(ObjectC, '__send__', ObjectC.methods.get('send'));
  def(ObjectC, 'public_send', ObjectC.methods.get('send'));
  def(ObjectC, 'method', (self, args) => { const n = args[0] instanceof RSymbol ? args[0].name : jsstr(args[0]); return makeProc((a) => send(self, n, a)); });
  def(ObjectC, 'to_s', (self) => new RString(toS(self)));
  def(ObjectC, 'inspect', (self) => new RString(inspect(self)));
  def(ObjectC, 'instance_variable_get', (self, args) => (self.ivars ? (self.ivars[ivName(args[0])] ?? null) : null));
  def(ObjectC, 'instance_variable_set', (self, args) => { if (self.ivars) self.ivars[ivName(args[0])] = args[1]; return args[1]; });
  def(ObjectC, 'instance_variable_defined?', (self, args) => (self.ivars ? ivName(args[0]) in self.ivars : false));
  def(ObjectC, 'instance_variables', (self) => (self.ivars ? Object.keys(self.ivars).map((k) => new RSymbol(k)) : []));
  def(ObjectC, 'method_missing', (self, args) => { raiseError(NoMethodErrorC, `undefined method '${args[0] instanceof RSymbol ? args[0].name : toS(args[0])}' for ${shortInspect(self)}`); });
  def(ObjectC, 'respond_to_missing?', () => false);
  def(ObjectC, 'extend', (self, args) => {
    for (const mod of args) {
      if (!(mod instanceof RClass)) raiseError(TypeErrorC, 'wrong argument type (expected Module)');
      if (self instanceof RObject || self instanceof RClass) {
        if (!self.ext) self.ext = [];
        if (!self.ext.includes(mod)) self.ext.push(mod);
        const hook = findSingletonMethod(mod, 'extended');
        if (hook) hook(mod, [self]);
      }
    }
    return self;
  });
  def(ObjectC, '!~', (self, args) => !truthy(send(self, '=~', [args[0]])));
  def(ObjectC, 'define_singleton_method', (self, args, blk) => {
    const n = args[0] instanceof RSymbol ? args[0].name : jsstr(args[0]);
    const body = blk || args[1];
    const fn = (recv, a, b) => body.fn([...a], recv);
    if (self instanceof RClass) self.smethods.set(n, fn);
    else if (self instanceof RObject) { if (!self.smeth) self.smeth = new Map(); self.smeth.set(n, fn); }
    return new RSymbol(n);
  });
  def(ObjectC, 'singleton_methods', (self) => {
    const out = new Set();
    if (self instanceof RClass) { let c = self; while (c) { for (const k of c.smethods.keys()) out.add(k); c = c.superclass; } }
    else if (self instanceof RObject && self.smeth) for (const k of self.smeth.keys()) out.add(k);
    return [...out].map((n) => new RSymbol(n));
  });
  def(ObjectC, 'public_methods', (self) => {
    const out = new Set();
    if (self instanceof RClass) {
      let c = self;
      while (c) {
        for (const k of c.smethods.keys()) out.add(k);
        if (c.ext) for (const m of c.ext) { let mm = m; for (const k of mm.methods.keys()) out.add(k); }
        c = c.superclass;
      }
    }
    if (self instanceof RObject && self.smeth) for (const k of self.smeth.keys()) out.add(k);
    let c = classOf(self);
    while (c) {
      for (const k of c.methods.keys()) out.add(k);
      for (const m of c.includes) for (const k of m.methods.keys()) out.add(k);
      c = c.superclass;
    }
    return [...out].map((n) => new RSymbol(n));
  });
  def(ObjectC, 'instance_of?', (self, args) => classOf(self) === args[0]);
  def(ObjectC, 'methods', (self) => { const out = new Set(); let c = classOf(self); while (c) { for (const k of c.methods.keys()) out.add(k); for (const m of c.includes) for (const k of m.methods.keys()) out.add(k); c = c.superclass; } return [...out].map((n) => new RSymbol(n)); });
  def(ObjectC, 'enum_for', (self, args) => self);
  def(ObjectC, 'to_enum', (self, args) => self);
  def(ObjectC, 'display', (self) => { out(toS(self)); return null; });
  def(ObjectC, 'caller', () => []);
  def(ObjectC, 'catch', (self, args, blk) => {
    const tag = args.length ? args[0] : new RObject(ObjectC);
    try { return callBlock(blk, [tag], self); }
    catch (e) { if (e instanceof ThrowSignal && rbEqual(e.tag, tag)) return e.value; throw e; }
  });
  def(ObjectC, 'throw', (self, args) => { throw new ThrowSignal(args[0], args.length > 1 ? args[1] : null); });
  def(ObjectC, 'warn', (self, args) => { for (const a of args) process.stderr.write(toS(a) + '\n'); return null; });
  def(ObjectC, '__method__', (self) => null);
}

function ivName(s) { const n = s instanceof RSymbol ? s.name : jsstr(s); return n.startsWith('@') ? n : '@' + n; }
function mkExc(cls, msg) { const o = new RObject(cls); o.ivars['@message'] = new RString(msg); return o; }

function putsImpl(args) {
  if (args.length === 0) { process.stdout.write('\n'); return; }
  for (const a of args) {
    if (Array.isArray(a)) { if (a.length === 0) process.stdout.write('\n'); else putsImpl(a); }
    else { const s = toS(a); process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }
  }
}

function dupValue(self) {
  if (self instanceof RString) { const s = new RString(self.value); if (self.rclass) s.rclass = self.rclass; return s; }
  if (Array.isArray(self)) { const a = self.slice(); if (self.rclass) a.rclass = self.rclass; return a; }
  if (self instanceof RHash) { const h = new RHash(); for (const [k, v] of self.entries()) h.set(k, v); if (self.rclass) h.rclass = self.rclass; return h; }
  if (self instanceof RObject) { const o = new RObject(self.rclass); Object.assign(o.ivars, self.ivars); if (self.ext) o.ext = [...self.ext]; return o; }
  return self;
}

// ---- Integer --------------------------------------------------------------
function installInteger() {
  const I = IntegerC;
  def(I, '+', (s, a) => (isInt(a[0]) ? s + a[0] : intCoerce(s, a[0], '+') ?? numericOp(s, a[0], (x, y) => x + y)));
  def(I, '-', (s, a) => (isInt(a[0]) ? s - a[0] : intCoerce(s, a[0], '-') ?? numericOp(s, a[0], (x, y) => x - y)));
  def(I, '*', (s, a) => (isInt(a[0]) ? s * a[0] : intCoerce(s, a[0], '*') ?? numericOp(s, a[0], (x, y) => x * y)));
  def(I, '/', (s, a) => {
    if (isInt(a[0])) { if (a[0] === 0) raiseError(ZeroDivisionErrorC, 'divided by 0'); return Math.floor(s / a[0]); }
    { const c = intCoerce(s, a[0], '/'); if (c !== undefined) return c; }
    return mkfloat(s / numVal(a[0]));
  });
  def(I, '%', (s, a) => (isInt(a[0]) ? ((s % a[0]) + a[0]) % a[0] : mkfloat(jsmod(s, numVal(a[0])))));
  def(I, 'modulo', I.methods.get('%'));
  def(I, '**', (s, a) => (isInt(a[0]) && a[0] >= 0 ? Math.pow(s, a[0]) : mkfloat(Math.pow(s, numVal(a[0])))));
  def(I, 'pow', (s, a) => {
    if (a[1] != null) { // modular exponentiation: pow(exp, mod)
      const m = BigInt(numVal(a[1])); if (m === 0n) raiseError(ZeroDivisionErrorC, 'divided by 0');
      let base = ((BigInt(s) % m) + m) % m; let exp = BigInt(numVal(a[0])); let r = 1n;
      while (exp > 0n) { if (exp & 1n) r = (r * base) % m; base = (base * base) % m; exp >>= 1n; }
      return Number(((r % m) + m) % m);
    }
    return send(s, '**', [a[0]]);
  });
  def(I, '-@', (s) => -s);
  def(I, '+@', (s) => s);
  def(I, '<=>', (s, a) => { const b = a[0]; if (b instanceof RRational) return send(mkRational(s, 1), '<=>', [b]); return isNum(b) ? cmpNum(s, b) : null; });
  def(I, '==', (s, a) => { const b = a[0]; if (b instanceof RRational || b instanceof RComplex) return truthy(send(b, '==', [s])); return isNum(b) && s === numVal(b); });
  def(I, '<', (s, a) => s < numVal(a[0]));
  def(I, '>', (s, a) => s > numVal(a[0]));
  def(I, '<=', (s, a) => s <= numVal(a[0]));
  def(I, '>=', (s, a) => s >= numVal(a[0]));
  def(I, '&', (s, a) => s & a[0]);
  def(I, '|', (s, a) => s | a[0]);
  def(I, '^', (s, a) => s ^ a[0]);
  def(I, '~', (s) => ~s);
  def(I, '[]', (s, a) => { const i = numVal(a[0]); if (i < 0) return 0; return Number((BigInt(s) >> BigInt(i)) & 1n); });
  def(I, '<<', (s, a) => s * Math.pow(2, a[0]));
  def(I, '>>', (s, a) => Math.floor(s / Math.pow(2, a[0])));
  def(I, 'times', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (let i = 0; i < s; i++) yield i; }); try { for (let i = 0; i < s; i++) safeYield(blk, [i]); } catch (e) { return brk(e); } return s; });
  def(I, 'upto', (s, a, blk) => { const to = numVal(a[0]); if (!blk) return mkEnum(function* () { for (let i = s; i <= to; i++) yield i; }); try { for (let i = s; i <= to; i++) safeYield(blk, [i]); } catch (e) { return brk(e); } return s; });
  def(I, 'downto', (s, a, blk) => { const to = numVal(a[0]); if (!blk) return mkEnum(function* () { for (let i = s; i >= to; i--) yield i; }); try { for (let i = s; i >= to; i--) safeYield(blk, [i]); } catch (e) { return brk(e); } return s; });
  def(I, 'step', (s, a, blk) => { const to = numVal(a[0]); const by = a[1] != null ? numVal(a[1]) : 1; if (!blk) return mkEnum(function* () { if (by > 0) { for (let i = s; i <= to; i += by) yield i; } else { for (let i = s; i >= to; i += by) yield i; } }); try { if (by > 0) for (let i = s; i <= to; i += by) safeYield(blk, [i]); else for (let i = s; i >= to; i += by) safeYield(blk, [i]); } catch (e) { return brk(e); } return s; });
  def(I, 'abs', (s) => Math.abs(s));
  def(I, 'magnitude', (s) => Math.abs(s));
  def(I, 'even?', (s) => s % 2 === 0);
  def(I, 'odd?', (s) => Math.abs(s % 2) === 1);
  def(I, 'zero?', (s) => s === 0);
  def(I, 'nonzero?', (s) => (s === 0 ? null : s));
  def(I, 'positive?', (s) => s > 0);
  def(I, 'negative?', (s) => s < 0);
  def(I, 'succ', (s) => s + 1);
  def(I, 'next', (s) => s + 1);
  def(I, 'pred', (s) => s - 1);
  def(I, 'to_i', (s) => s);
  def(I, 'to_int', (s) => s);
  def(I, 'to_f', (s) => mkfloat(s));
  def(I, 'to_s', (s, a) => new RString(a && a[0] != null ? s.toString(numVal(a[0])) : String(s)));
  def(I, 'inspect', (s) => new RString(String(s)));
  def(I, 'to_r', (s) => new RRational(s, 1));
  def(I, 'rationalize', (s) => new RRational(s, 1));
  def(I, 'numerator', (s) => s);
  def(I, 'denominator', () => 1);
  def(I, 'to_c', (s) => mkComplex(s, 0));
  def(I, 'chr', (s) => new RString(String.fromCharCode(s)));
  def(I, 'ord', (s) => s);
  def(I, 'floor', (s, a) => roundInt(s, a, 'floor'));
  def(I, 'ceil', (s, a) => roundInt(s, a, 'ceil'));
  def(I, 'round', (s, a) => roundInt(s, a, 'round'));
  def(I, 'truncate', (s) => s);
  def(I, 'gcd', (s, a) => gcd(Math.abs(s), Math.abs(numVal(a[0]))));
  def(I, 'lcm', (s, a) => { const b = Math.abs(numVal(a[0])); return s === 0 || b === 0 ? 0 : Math.abs(s * b) / gcd(Math.abs(s), b); });
  def(I, 'divmod', (s, a) => { const b = numVal(a[0]); return [Math.floor(s / b), ((s % b) + b) % b]; });
  def(I, 'fdiv', (s, a) => mkfloat(s / numVal(a[0])));
  def(I, 'div', (s, a) => Math.floor(s / numVal(a[0])));
  def(I, 'remainder', (s, a) => s % numVal(a[0]));
  def(I, 'digits', (s, a) => { const base = a && a[0] != null ? numVal(a[0]) : 10; let n = Math.abs(s); const out = []; if (n === 0) return [0]; while (n > 0) { out.push(n % base); n = Math.floor(n / base); } return out; });
  def(I, 'bit_length', (s) => (s === 0 ? 0 : Math.floor(Math.log2(Math.abs(s))) + 1));
  def(I, 'coerce', (s, a) => [mkfloat(numVal(a[0])), mkfloat(s)]);
  def(I, 'integer?', () => true);
  def(I, 'between?', (s, a) => s >= numVal(a[0]) && s <= numVal(a[1]));
  def(I, 'clamp', (s, a) => { if (a[0] instanceof RRange) { const lo = a[0].from, hi = a[0].to; return s < lo ? lo : s > hi ? hi : s; } const lo = numVal(a[0]), hi = numVal(a[1]); return s < lo ? lo : s > hi ? hi : s; });
  def(I, 'hash', (s) => s);
  def(I, 'gcdlcm', (s, a) => [send(s, 'gcd', a), send(s, 'lcm', a)]);
}

function jsmod(a, b) { return ((a % b) + b) % b; }
function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
// Integer arithmetic with a Rational/Complex operand: promote self and re-dispatch.
function intCoerce(s, b, op) {
  if (b instanceof RRational) return send(mkRational(s, 1), op, [b]);
  if (b instanceof RComplex) return send(mkComplex(s, 0), op, [b]);
  return undefined;
}
function cmpNum(a, b) { const x = numVal(a), y = numVal(b); return x < y ? -1 : x > y ? 1 : 0; }
function numericOp(a, b, f) {
  if (isNum(b)) { const r = f(numVal(a), numVal(b)); return (isInt(a) && isInt(b)) ? r : mkfloat(r); }
  // coerce
  if (respondTo(b, 'coerce')) { const pair = send(b, 'coerce', [a]); return send(pair[0], opName(f), [pair[1]]); }
  raiseError(TypeErrorC, `${classOf(b).name} can't be coerced into Numeric`);
}
function opName() { return '+'; }
function roundInt(s, a, mode) {
  const d = a && a[0] != null ? numVal(a[0]) : 0;
  if (d >= 0) return s;
  const f = Math.pow(10, -d);
  if (mode === 'floor') return Math.floor(s / f) * f;
  if (mode === 'ceil') return Math.ceil(s / f) * f;
  return Math.round(s / f) * f;
}
function safeYield(blk, args) {
  try { return callBlock(blk, args); }
  catch (e) { if (e instanceof NextError) return e.value; throw e; }
}
function brk(e) { if (e instanceof BreakError) return e.value; throw e; }

// ---- Float ----------------------------------------------------------------
function installFloat() {
  const F = FloatC;
  def(F, '+', (s, a) => (a[0] instanceof RComplex ? send(mkComplex(s, 0), '+', [a[0]]) : mkfloat(s.value + numVal(a[0]))));
  def(F, '-', (s, a) => (a[0] instanceof RComplex ? send(mkComplex(s, 0), '-', [a[0]]) : mkfloat(s.value - numVal(a[0]))));
  def(F, '*', (s, a) => (a[0] instanceof RComplex ? send(mkComplex(s, 0), '*', [a[0]]) : mkfloat(s.value * numVal(a[0]))));
  def(F, '/', (s, a) => (a[0] instanceof RComplex ? send(mkComplex(s, 0), '/', [a[0]]) : mkfloat(s.value / numVal(a[0]))));
  def(F, '%', (s, a) => mkfloat(jsmod(s.value, numVal(a[0]))));
  def(F, 'modulo', F.methods.get('%'));
  def(F, '**', (s, a) => mkfloat(Math.pow(s.value, numVal(a[0]))));
  def(F, 'pow', F.methods.get('**'));
  def(F, '-@', (s) => mkfloat(-s.value));
  def(F, '+@', (s) => s);
  def(F, '<=>', (s, a) => (isNum(a[0]) ? cmpNum(s, a[0]) : null));
  def(F, '==', (s, a) => isNum(a[0]) && s.value === numVal(a[0]));
  def(F, '<', (s, a) => s.value < numVal(a[0]));
  def(F, '>', (s, a) => s.value > numVal(a[0]));
  def(F, '<=', (s, a) => s.value <= numVal(a[0]));
  def(F, '>=', (s, a) => s.value >= numVal(a[0]));
  def(F, 'abs', (s) => mkfloat(Math.abs(s.value)));
  def(F, 'to_i', (s) => Math.trunc(s.value));
  def(F, 'to_int', (s) => Math.trunc(s.value));
  def(F, 'to_f', (s) => s);
  def(F, 'to_r', (s) => floatToRational(s.value));
  def(F, 'rationalize', (s) => rationalizeFloat(s.value));
  def(F, 'to_c', (s) => mkComplex(s, 0));
  def(F, 'to_s', (s) => new RString(floatToS(s.value)));
  def(F, 'inspect', (s) => new RString(floatToS(s.value)));
  def(F, 'floor', (s, a) => floatRound(s.value, a, Math.floor));
  def(F, 'ceil', (s, a) => floatRound(s.value, a, Math.ceil));
  def(F, 'round', (s, a) => floatRound(s.value, a, Math.round));
  def(F, 'truncate', (s) => Math.trunc(s.value));
  def(F, 'nan?', (s) => Number.isNaN(s.value));
  def(F, 'infinite?', (s) => (s.value === Infinity ? 1 : s.value === -Infinity ? -1 : null));
  def(F, 'finite?', (s) => Number.isFinite(s.value));
  def(F, 'zero?', (s) => s.value === 0);
  def(F, 'positive?', (s) => s.value > 0);
  def(F, 'negative?', (s) => s.value < 0);
  def(F, 'divmod', (s, a) => { const b = numVal(a[0]); return [Math.floor(s.value / b), mkfloat(jsmod(s.value, b))]; });
  def(F, 'fdiv', (s, a) => mkfloat(s.value / numVal(a[0])));
  def(F, 'coerce', (s, a) => [mkfloat(numVal(a[0])), s]);
  def(F, 'integer?', () => false);
  def(F, 'between?', (s, a) => s.value >= numVal(a[0]) && s.value <= numVal(a[1]));
  def(F, 'clamp', (s, a) => { const lo = numVal(a[0]), hi = numVal(a[1]); return mkfloat(s.value < lo ? lo : s.value > hi ? hi : s.value); });
  def(F, 'nonzero?', (s) => (s.value === 0 ? null : s));
  def(F, 'step', (s, a, blk) => { const to = numVal(a[0]); const by = a[1] != null ? numVal(a[1]) : 1; if (!blk) return mkEnum(function* () { if (by > 0) { for (let i = s.value; i <= to + 1e-9; i += by) yield mkfloat(i); } else { for (let i = s.value; i >= to - 1e-9; i += by) yield mkfloat(i); } }); try { if (by > 0) for (let i = s.value; i <= to + 1e-9; i += by) safeYield(blk, [mkfloat(i)]); else for (let i = s.value; i >= to - 1e-9; i += by) safeYield(blk, [mkfloat(i)]); } catch (e) { return brk(e); } return s; });
}
function floatRound(v, a, fn) {
  const d = a && a[0] != null ? numVal(a[0]) : 0;
  if (d === 0) return fn(v);
  const f = Math.pow(10, d);
  return mkfloat(fn(v * f) / f);
}

// ---- Rational / Complex ---------------------------------------------------
function bigGcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a || 1n; }
function mkRational(num, den) {
  if (den === 0) raiseError(ZeroDivisionErrorC, 'divided by 0');
  if (den < 0) { num = -num; den = -den; }
  const g = gcd(Math.abs(num), Math.abs(den)) || 1;
  return new RRational(num / g, den / g);
}
// Exact IEEE-754 double -> Rational (matches MRI's Float#to_r for normal values).
function floatToRational(f) {
  if (!Number.isFinite(f)) raiseError(ArgumentErrorC, 'value out of range');
  if (f === 0) return new RRational(0, 1);
  const buf = new DataView(new ArrayBuffer(8)); buf.setFloat64(0, f);
  const bits = buf.getBigUint64(0);
  const sign = (bits >> 63n) & 1n; let exp = Number((bits >> 52n) & 0x7ffn); let mant = bits & 0xfffffffffffffn;
  if (exp === 0) exp = -1074; else { mant |= 0x10000000000000n; exp -= 1075; }
  let num = mant; let den = 1n;
  if (exp >= 0) num <<= BigInt(exp); else den <<= BigInt(-exp);
  if (sign) num = -num;
  const g = bigGcd(num, den); num /= g; den /= g;
  return new RRational(Number(num), Number(den));
}
function toRational(v) { if (v instanceof RRational) return v; if (isInt(v)) return new RRational(v, 1); if (v instanceof RFloat) return floatToRational(v.value); raiseError(TypeErrorC, `can't convert ${classOf(v).name} into Rational`); }
// Float#rationalize: the simplest rational matching the float's shortest decimal.
function rationalizeFloat(f) {
  if (!Number.isFinite(f)) raiseError(ArgumentErrorC, 'value out of range');
  if (Number.isInteger(f)) return new RRational(f, 1);
  const str = String(f);
  if (str.includes('e') || str.includes('E')) return floatToRational(f);
  const [ip, fp] = str.split('.');
  return mkRational(parseInt(ip + fp, 10), Math.pow(10, fp.length));
}
function mkComplex(re, im) { return new RComplex(re, im); }
// Numeric "quo" division: Integer/Integer yields a Rational (like MRI), else `/`.
function numQuo(x, d) { if (isInt(x) && isInt(d)) return x % d === 0 ? x / d : mkRational(x, d); return send(x, '/', [d]); }
function toComplex(v) { return v instanceof RComplex ? v : mkComplex(v, 0); }
function realZero(x) { return isInt(x) ? x === 0 : (x instanceof RFloat ? x.value === 0 : (x instanceof RRational ? x.num === 0 : false)); }
function ratArith(s, b, op) {
  if (b instanceof RFloat) return send(mkfloat(s.num / s.den), op, [b]);
  if (b instanceof RComplex) return send(mkComplex(s, 0), op, [b]);
  const r = toRational(b);
  switch (op) {
    case '+': return mkRational(s.num * r.den + r.num * s.den, s.den * r.den);
    case '-': return mkRational(s.num * r.den - r.num * s.den, s.den * r.den);
    case '*': return mkRational(s.num * r.num, s.den * r.den);
    case '/': return mkRational(s.num * r.den, s.den * r.num);
  }
}
function ratToS(s) { return `${s.num}/${s.den}`; }
function installRational() {
  const Ra = RationalC;
  for (const op of ['+', '-', '*', '/']) def(Ra, op, (s, a) => ratArith(s, a[0], op));
  def(Ra, '**', (s, a) => { const b = a[0]; if (isInt(b)) { if (b >= 0) return mkRational(Math.pow(s.num, b), Math.pow(s.den, b)); return mkRational(Math.pow(s.den, -b), Math.pow(s.num, -b)); } return mkfloat(Math.pow(s.num / s.den, numVal(b))); });
  def(Ra, '-@', (s) => new RRational(-s.num, s.den));
  def(Ra, '+@', (s) => s);
  def(Ra, '<=>', (s, a) => { const b = a[0]; if (b instanceof RFloat) return cmpNum(mkfloat(s.num / s.den), b); if (b instanceof RRational || isInt(b)) { const r = toRational(b); const l = s.num * r.den, rr = r.num * s.den; return l < rr ? -1 : l > rr ? 1 : 0; } return null; });
  def(Ra, '==', (s, a) => { const b = a[0]; if (b instanceof RRational) return s.num === b.num && s.den === b.den; if (isInt(b)) return s.den === 1 && s.num === b; if (b instanceof RFloat) return s.num / s.den === b.value; return false; });
  def(Ra, 'abs', (s) => new RRational(Math.abs(s.num), s.den));
  def(Ra, 'numerator', (s) => s.num);
  def(Ra, 'denominator', (s) => s.den);
  def(Ra, 'to_r', (s) => s);
  def(Ra, 'rationalize', (s) => s);
  def(Ra, 'to_f', (s) => mkfloat(s.num / s.den));
  def(Ra, 'to_i', (s) => Math.trunc(s.num / s.den));
  def(Ra, 'to_int', (s) => Math.trunc(s.num / s.den));
  def(Ra, 'truncate', (s) => Math.trunc(s.num / s.den));
  def(Ra, 'floor', (s, a) => (a && a[0] != null ? floatRound(s.num / s.den, a, Math.floor) : Math.floor(s.num / s.den)));
  def(Ra, 'ceil', (s, a) => (a && a[0] != null ? floatRound(s.num / s.den, a, Math.ceil) : Math.ceil(s.num / s.den)));
  def(Ra, 'round', (s, a) => (a && a[0] != null ? floatRound(s.num / s.den, a, Math.round) : Math.round(s.num / s.den)));
  def(Ra, 'zero?', (s) => s.num === 0);
  def(Ra, 'positive?', (s) => s.num > 0);
  def(Ra, 'negative?', (s) => s.num < 0);
  def(Ra, 'integer?', () => false);
  def(Ra, 'coerce', (s, a) => { const b = a[0]; if (b instanceof RFloat) return [b, mkfloat(s.num / s.den)]; return [toRational(b), s]; });
  def(Ra, 'to_s', (s) => new RString(ratToS(s)));
  def(Ra, 'inspect', (s) => new RString(`(${ratToS(s)})`));
  def(Ra, 'hash', (s) => (s.num * 31 + s.den) | 0);
}
function cplxToS(s, withParen) {
  // MRI: components rendered via inspect (parenthesized) for #inspect, via to_s
  // otherwise; a `*` precedes `i` when the imaginary string doesn't end in a digit.
  const render = withParen ? inspect : toS;
  const imNeg = truthy(send(s.im, 'negative?', []));
  const imAbs = render(send(s.im, 'abs', []));
  const star = /[0-9]$/.test(imAbs) ? '' : '*';
  const body = `${render(s.re)}${imNeg ? '-' : '+'}${imAbs}${star}i`;
  return withParen ? `(${body})` : body;
}
function installComplex() {
  const Cx = ComplexC;
  def(Cx, '+', (s, a) => { const b = toComplex(a[0]); return mkComplex(send(s.re, '+', [b.re]), send(s.im, '+', [b.im])); });
  def(Cx, '-', (s, a) => { const b = toComplex(a[0]); return mkComplex(send(s.re, '-', [b.re]), send(s.im, '-', [b.im])); });
  def(Cx, '*', (s, a) => { const b = toComplex(a[0]); return mkComplex(send(send(s.re, '*', [b.re]), '-', [send(s.im, '*', [b.im])]), send(send(s.re, '*', [b.im]), '+', [send(s.im, '*', [b.re])])); });
  def(Cx, '/', (s, a) => { const b = toComplex(a[0]); const denom = send(send(b.re, '*', [b.re]), '+', [send(b.im, '*', [b.im])]); const re = numQuo(send(send(s.re, '*', [b.re]), '+', [send(s.im, '*', [b.im])]), denom); const im = numQuo(send(send(s.im, '*', [b.re]), '-', [send(s.re, '*', [b.im])]), denom); return mkComplex(re, im); });
  def(Cx, '-@', (s) => mkComplex(send(s.re, '-@', []), send(s.im, '-@', [])));
  def(Cx, '+@', (s) => s);
  def(Cx, '==', (s, a) => { const b = a[0]; if (b instanceof RComplex) return truthy(send(s.re, '==', [b.re])) && truthy(send(s.im, '==', [b.im])); if (isNum(b) || b instanceof RRational) return realZero(s.im) && truthy(send(s.re, '==', [b])); return false; });
  def(Cx, 'real', (s) => s.re);
  def(Cx, 'imaginary', (s) => s.im);
  def(Cx, 'imag', (s) => s.im);
  def(Cx, 'conjugate', (s) => mkComplex(s.re, send(s.im, '-@', [])));
  def(Cx, 'conj', Cx.methods.get('conjugate'));
  def(Cx, 'abs', (s) => mkfloat(Math.hypot(numVal(s.re), numVal(s.im))));
  def(Cx, 'magnitude', Cx.methods.get('abs'));
  def(Cx, 'abs2', (s) => send(send(s.re, '*', [s.re]), '+', [send(s.im, '*', [s.im])]));
  def(Cx, 'arg', (s) => mkfloat(Math.atan2(numVal(s.im), numVal(s.re))));
  def(Cx, 'angle', Cx.methods.get('arg'));
  def(Cx, 'phase', Cx.methods.get('arg'));
  def(Cx, 'rectangular', (s) => [s.re, s.im]);
  def(Cx, 'rect', Cx.methods.get('rectangular'));
  def(Cx, 'to_c', (s) => s);
  def(Cx, 'to_s', (s) => new RString(cplxToS(s, false)));
  def(Cx, 'inspect', (s) => new RString(cplxToS(s, true)));
  def(Cx, 'coerce', (s, a) => [toComplex(a[0]), s]);
  def(Cx, 'hash', (s) => (numVal(s.re) * 31 + numVal(s.im)) | 0);
}

function installNumeric() {
  def(NumericC, 'integer?', () => false);
  def(NumericC, 'step', IntegerC.methods.get('step'));
}

function checkFrozen(obj) {
  if (obj && obj.__frozen) {
    const cn = classOf(obj) ? classOf(obj).name : 'Object';
    raiseError(FrozenErrorC, `can't modify frozen ${cn}: ${inspect(obj)}`);
  }
}

// ---- String ---------------------------------------------------------------
function installString() {
  const S = StringC;
  const v = (s) => s.value;
  // Base initialize so String subclasses can `super(str)`.
  def(S, 'initialize', (s, a) => { s.value = a[0] != null ? jsstr(a[0]) : ''; return null; });
  sdef(S, 'new', (cls, a, blk) => {
    const s = new RString('');
    if (cls !== StringC && cls instanceof RClass) s.rclass = cls;
    const init = findMethod(cls instanceof RClass ? cls : StringC, 'initialize');
    init(s, a, blk);
    return s;
  });
  def(S, '+', (s, a) => { if (!(a[0] instanceof RString)) raiseError(TypeErrorC, `no implicit conversion of ${classOf(a[0]).name} into String`); return new RString(s.value + a[0].value); });
  def(S, '*', (s, a) => new RString(s.value.repeat(numVal(a[0]))));
  def(S, '<<', (s, a) => { checkFrozen(s); s.value += (typeof a[0] === 'number' ? String.fromCharCode(a[0]) : toS(a[0])); return s; });
  def(S, 'concat', (s, a) => { checkFrozen(s); for (const x of a) s.value += toS(x); return s; });
  def(S, 'prepend', (s, a) => { checkFrozen(s); s.value = a.map(toS).join('') + s.value; return s; });
  def(S, '%', (s, a) => new RString(sprintf(s.value, Array.isArray(a[0]) ? a[0] : [a[0]])));
  def(S, '+@', (s) => (s.__frozen ? new RString(s.value) : s));
  def(S, '-@', (s) => { s.__frozen = true; return s; });
  def(S, '==', (s, a) => a[0] instanceof RString && s.value === a[0].value);
  def(S, 'eql?', (s, a) => a[0] instanceof RString && s.value === a[0].value);
  def(S, '<=>', (s, a) => (a[0] instanceof RString ? (s.value < a[0].value ? -1 : s.value > a[0].value ? 1 : 0) : null));
  def(S, '<', (s, a) => s.value < a[0].value);
  def(S, '>', (s, a) => s.value > a[0].value);
  def(S, '<=', (s, a) => s.value <= a[0].value);
  def(S, '>=', (s, a) => s.value >= a[0].value);
  def(S, 'length', (s) => [...s.value].length);
  def(S, 'size', S.methods.get('length'));
  def(S, 'bytesize', (s) => Buffer.byteLength(s.value, 'utf8'));
  def(S, 'upcase', (s) => new RString(s.value.toUpperCase()));
  def(S, 'downcase', (s) => new RString(s.value.toLowerCase()));
  def(S, 'upcase!', (s) => { checkFrozen(s); const o = s.value; s.value = s.value.toUpperCase(); return o === s.value ? null : s; });
  def(S, 'downcase!', (s) => { checkFrozen(s); const o = s.value; s.value = s.value.toLowerCase(); return o === s.value ? null : s; });
  def(S, 'capitalize', (s) => new RString(s.value.charAt(0).toUpperCase() + s.value.slice(1).toLowerCase()));
  def(S, 'capitalize!', (s) => { checkFrozen(s); const o = s.value; s.value = s.value.charAt(0).toUpperCase() + s.value.slice(1).toLowerCase(); return o === s.value ? null : s; });
  def(S, 'swapcase', (s) => new RString(s.value.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))));
  def(S, 'reverse', (s) => new RString([...s.value].reverse().join('')));
  def(S, 'reverse!', (s) => { checkFrozen(s); s.value = [...s.value].reverse().join(''); return s; });
  def(S, 'strip', (s) => new RString(s.value.replace(/^\s+|\s+$/g, '')));
  def(S, 'lstrip', (s) => new RString(s.value.replace(/^\s+/, '')));
  def(S, 'rstrip', (s) => new RString(s.value.replace(/\s+$/, '')));
  def(S, 'strip!', (s) => { checkFrozen(s); const o = s.value; s.value = s.value.trim(); return o === s.value ? null : s; });
  def(S, 'lstrip!', (s) => { checkFrozen(s); const o = s.value; s.value = s.value.replace(/^\s+/, ''); return o === s.value ? null : s; });
  def(S, 'rstrip!', (s) => { checkFrozen(s); const o = s.value; s.value = s.value.replace(/\s+$/, ''); return o === s.value ? null : s; });
  def(S, 'chomp', (s, a) => new RString(a[0] ? (s.value.endsWith(jsstr(a[0])) ? s.value.slice(0, -jsstr(a[0]).length) : s.value) : s.value.replace(/\r?\n$/, '')));
  def(S, 'chomp!', (s, a) => { checkFrozen(s); const o = s.value; s.value = jsstr(send(s, 'chomp', a)); return o === s.value ? null : s; });
  def(S, 'chop', (s) => new RString(s.value.replace(/(\r\n|.)$/, '')));
  def(S, 'chars', (s) => [...s.value].map((c) => new RString(c)));
  def(S, 'bytes', (s) => [...Buffer.from(s.value, 'utf8')]);
  def(S, 'lines', (s) => { const parts = s.value.split(/(?<=\n)/); return parts.filter((p) => p.length).map((p) => new RString(p)); });
  def(S, 'each_char', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (const c of s.value) yield new RString(c); }); try { for (const c of s.value) safeYield(blk, [new RString(c)]); } catch (e) { return brk(e); } return s; });
  def(S, 'each_line', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (const l of s.value.split(/(?<=\n)/)) if (l.length) yield new RString(l); }); try { for (const l of s.value.split(/(?<=\n)/)) if (l.length) safeYield(blk, [new RString(l)]); } catch (e) { return brk(e); } return s; });
  def(S, 'grapheme_clusters', (s) => graphemes(s.value).map((g) => new RString(g)));
  def(S, 'each_grapheme_cluster', (s, a, blk) => { const gs = graphemes(s.value); if (!blk) return mkEnum(function* () { for (const g of gs) yield new RString(g); }); try { for (const g of gs) safeYield(blk, [new RString(g)]); } catch (e) { return brk(e); } return s; });
  def(S, 'each_byte', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (const b of Buffer.from(s.value, 'utf8')) yield b; }); try { for (const b of Buffer.from(s.value, 'utf8')) safeYield(blk, [b]); } catch (e) { return brk(e); } return s; });
  def(S, 'split', (s, a) => strSplit(s.value, a));
  def(S, 'include?', (s, a) => s.value.includes(jsstr(a[0])));
  def(S, 'start_with?', (s, a) => a.some((x) => s.value.startsWith(jsstr(x))));
  def(S, 'end_with?', (s, a) => a.some((x) => s.value.endsWith(jsstr(x))));
  def(S, 'index', (s, a) => {
    const chars = [...s.value];
    if (a[0] instanceof RRegexp) {
      const offset = a[1] != null ? chars.slice(0, numVal(a[1])).join('').length : 0;
      const re = jsRe(a[0], true); re.lastIndex = offset;
      const m = re.exec(s.value); if (!m) return null;
      return [...s.value.slice(0, m.index)].length;
    }
    const needle = jsstr(a[0]);
    const startChar = a[1] != null ? numVal(a[1]) : 0;
    const startByte = chars.slice(0, startChar < 0 ? Math.max(0, chars.length + startChar) : startChar).join('').length;
    const bi = s.value.indexOf(needle, startByte);
    return bi < 0 ? null : [...s.value.slice(0, bi)].length;
  });
  def(S, 'rindex', (s, a) => { const needle = jsstr(a[0]); const bi = s.value.lastIndexOf(needle); return bi < 0 ? null : [...s.value.slice(0, bi)].length; });
  def(S, 'replace', (s, a) => { checkFrozen(s); s.value = jsstr(a[0]); return s; });
  def(S, 'sub', (s, a, blk) => new RString(strSub(s.value, a, blk, false)));
  def(S, 'gsub', (s, a, blk) => new RString(strSub(s.value, a, blk, true)));
  def(S, 'sub!', (s, a, blk) => { checkFrozen(s); const o = s.value; s.value = strSub(s.value, a, blk, false); return o === s.value ? null : s; });
  def(S, 'gsub!', (s, a, blk) => { checkFrozen(s); const o = s.value; s.value = strSub(s.value, a, blk, true); return o === s.value ? null : s; });
  def(S, 'tr', (s, a) => new RString(strTr(s.value, jsstr(a[0]), jsstr(a[1]))));
  def(S, 'tr!', (s, a) => { checkFrozen(s); const o = s.value; s.value = strTr(s.value, jsstr(a[0]), jsstr(a[1])); return o === s.value ? null : s; });
  def(S, 'delete', (s, a) => new RString(strTr(s.value, jsstr(a[0]), '')));
  def(S, 'delete!', (s, a) => { checkFrozen(s); const o = s.value; s.value = strTr(s.value, jsstr(a[0]), ''); return o === s.value ? null : s; });
  def(S, 'count', (s, a) => { const set = expandTr(jsstr(a[0])); let n = 0; for (const c of s.value) if (set.includes(c)) n++; return n; });
  def(S, 'squeeze', (s, a) => {
    if (a.length === 0) return new RString(s.value.replace(/(.)\1+/g, '$1'));
    const set = expandTr(jsstr(a[0])); // chars eligible for squeezing
    let out = ''; let prev = null;
    for (const c of s.value) { if (c === prev && set.indexOf(c) >= 0) continue; out += c; prev = c; }
    return new RString(out);
  });
  def(S, 'squeeze!', (s) => { checkFrozen(s); const o = s.value; s.value = s.value.replace(/(.)\1+/g, '$1'); return o === s.value ? null : s; });
  def(S, 'to_i', (s, a) => { const base = a && a[0] != null ? numVal(a[0]) : 10; const re = base === 16 ? /^[-+]?[0-9a-fA-F]+/ : base === 2 ? /^[-+]?[01]+/ : base === 8 ? /^[-+]?[0-7]+/ : /^[-+]?\d+/; const m = s.value.trim().match(re); const n = m ? parseInt(m[0], base) : 0; return Number.isNaN(n) ? 0 : n; });
  def(S, 'to_f', (s) => { const m = s.value.trim().match(/^[-+]?\d*\.?\d+([eE][-+]?\d+)?/); return mkfloat(m ? parseFloat(m[0]) : 0); });
  def(S, 'to_s', (s) => s);
  def(S, 'to_str', (s) => s);
  def(S, 'to_sym', (s) => R.sym(s.value));
  def(S, 'intern', (s) => R.sym(s.value));
  def(S, 'inspect', (s) => new RString(strInspect(s.value)));
  def(S, 'empty?', (s) => s.value.length === 0);
  def(S, 'hash', (s) => { let h = 0; for (let i = 0; i < s.value.length; i++) h = (h * 31 + s.value.charCodeAt(i)) | 0; return h; });
  def(S, '[]', (s, a) => strSlice(s, a));
  def(S, 'slice', (s, a) => strSlice(s, a));
  def(S, '[]=', (s, a) => strSliceSet(s, a));
  def(S, 'center', (s, a) => { const w = numVal(a[0]); const pad = a[1] ? jsstr(a[1]) : ' '; if (s.value.length >= w) return new RString(s.value); const total = w - s.value.length; const left = Math.floor(total / 2); const right = total - left; return new RString(padStr(pad, left) + s.value + padStr(pad, right)); });
  def(S, 'ljust', (s, a) => { const w = numVal(a[0]); const pad = a[1] ? jsstr(a[1]) : ' '; return new RString(s.value.length >= w ? s.value : s.value + padStr(pad, w - s.value.length)); });
  def(S, 'rjust', (s, a) => { const w = numVal(a[0]); const pad = a[1] ? jsstr(a[1]) : ' '; return new RString(s.value.length >= w ? s.value : padStr(pad, w - s.value.length) + s.value); });
  def(S, 'ord', (s) => s.value.charCodeAt(0));
  def(S, 'chr', (s) => new RString(s.value.charAt(0)));
  def(S, 'succ', (s) => new RString(strSucc(s.value)));
  def(S, 'next', (s) => new RString(strSucc(s.value)));
  def(S, 'freeze', (s) => { s.__frozen = true; return s; });
  def(S, 'frozen?', (s) => !!s.__frozen);
  def(S, 'dup', (s) => new RString(s.value));
  def(S, 'format', (s, a) => new RString(sprintf(s.value, a)));
  def(S, 'match?', (s, a) => jsRe(a[0]).test(s.value));
  def(S, 'match', (s, a, blk) => { const m = s.value.match(jsRe(a[0])); gvars['$~'] = m ? mkMatchData(m, s.value) : null; if (!m) return null; const md = mkMatchData(m, s.value); return blk ? callBlock(blk, [md]) : md; });
  def(S, 'scan', (s, a, blk) => { const re = jsRe(a[0], true); const out = []; let m; while ((m = re.exec(s.value))) { const item = m.length > 1 ? m.slice(1).map((x) => (x != null ? new RString(x) : null)) : new RString(m[0]); if (blk) callBlock(blk, [item]); else out.push(item); if (m.index === re.lastIndex) re.lastIndex++; } return blk ? s : out; });
  def(S, '=~', (s, a) => { if (!(a[0] instanceof RRegexp)) return null; const m = s.value.match(jsRe(a[0])); gvars['$~'] = m ? mkMatchData(m, s.value) : null; return m ? m.index : null; });
  def(S, 'each_with_index', (s, a, blk) => { let i = 0; for (const c of s.value) safeYield(blk, [new RString(c), i++]); return s; });
  def(S, 'encoding', (s) => new RString('UTF-8'));
  def(S, 'force_encoding', (s) => s);
  def(S, 'valid_encoding?', () => true);
  def(S, 'ascii_only?', (s) => /^[\x00-\x7f]*$/.test(s.value));
  def(S, 'encode', (s) => new RString(s.value));
  def(S, 'b', (s) => new RString(s.value));
  def(S, 'scrub', (s, a) => new RString(s.value));
  def(S, 'unicode_normalize', (s) => new RString(s.value.normalize()));
  def(S, 'unpack', (s, a) => rbUnpack(s.value, jsstr(a[0])));
  def(S, 'unpack1', (s, a) => { const r = rbUnpack(s.value, jsstr(a[0])); return r.length ? r[0] : null; });
  def(S, 'b', (s) => s);
}

function padStr(pad, len) { let out = ''; while (out.length < len) out += pad; return out.slice(0, len); }
function strSplit(str, a) {
  if (a.length === 0 || a[0] === null) return str.trim().split(/\s+/).filter((x) => x.length).map((x) => new RString(x));
  const sep = a[0];
  // limit omitted or 0 -> drop trailing empties; negative -> keep all; positive -> cap.
  const limit = a[1] != null ? numVal(a[1]) : 0;
  const dropTrailing = limit === 0;
  if (sep instanceof RRegexp) {
    const re = new RegExp(sep.re.source, sep.re.flags.replace('g', ''));
    let parts = limit > 0 ? str.split(re, undefined) : str.split(re);
    if (limit > 0 && parts.length > limit) { const head = str.split(re); parts = head.slice(0, limit - 1); parts.push(head.slice(limit - 1).join('')); }
    if (dropTrailing) { while (parts.length && parts[parts.length - 1] === '') parts.pop(); }
    return parts.map((p) => new RString(p == null ? '' : p));
  }
  if (sep instanceof RString && sep.value === ' ') return str.trim().split(/\s+/).filter((x) => x.length).map((x) => new RString(x));
  if (sep instanceof RString && sep.value === '') return [...str].map((c) => new RString(c));
  const sepStr = jsstr(sep);
  let parts = str.split(sepStr);
  if (limit > 0 && parts.length > limit) parts = parts.slice(0, limit - 1).concat(parts.slice(limit - 1).join(sepStr));
  else if (dropTrailing) { while (parts.length && parts[parts.length - 1] === '') parts.pop(); }
  return parts.map((p) => new RString(p));
}
function strSub(str, a, blk, global) {
  const pat = a[0];
  const re = jsRe(pat, global);
  if (blk) return str.replace(re, (...args) => {
    // args: (match, p1, p2, ..., offset, string [, groups])
    const hasNamed = typeof args[args.length - 1] === 'object';
    const end = args.length - (hasNamed ? 3 : 2);
    const m = args.slice(0, end);
    m.index = args[end];
    m.input = str;
    gvars['$~'] = mkMatchData(m, str);
    return toS(callBlock(blk, [new RString(args[0])]));
  });
  const rep = a[1];
  if (rep instanceof RHash) return str.replace(re, (m) => { const val = rep.get(new RString(m)); return val == null ? '' : toS(val); });
  return str.replace(re, rubyReplToJs(jsstr(rep)));
}
// Translate a Ruby sub/gsub replacement string into a JS one. Ruby backrefs:
// \1-\9 groups, \0 or \& whole match, \k<name> named, \` pre, \' post. A bare
// `$` is literal in Ruby (escaped to `$$` for JS).
function rubyReplToJs(rep) {
  let out = '';
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i];
    if (c === '$') { out += '$$'; continue; }
    if (c !== '\\') { out += c; continue; }
    const n = rep[i + 1];
    if (n === undefined) { out += '\\'; }
    else if (n === '0' || n === '&') { out += '$&'; i++; }
    else if (n >= '1' && n <= '9') { out += '$' + n; i++; }
    else if (n === '`') { out += '$`'; i++; }
    else if (n === "'") { out += "$'"; i++; }
    else if (n === '\\') { out += '\\'; i++; }
    else if (n === 'k' && rep[i + 2] === '<') { const close = rep.indexOf('>', i + 3); if (close >= 0) { out += '$<' + rep.slice(i + 3, close) + '>'; i = close; } else { out += '\\'; } }
    else { out += n; i++; }
  }
  return out;
}
function graphemes(str) { return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)].map((seg) => seg.segment); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function strTr(str, from, to) {
  // A leading `^` negates the from-set (matches every char NOT listed).
  const negated = from.length > 1 && from[0] === '^';
  const fset = expandTr(negated ? from.slice(1) : from);
  const tset = expandTr(to);
  let out = '';
  for (const c of str) {
    const inSet = fset.indexOf(c) >= 0;
    const match = negated ? !inSet : inSet;
    if (match) {
      // negated: all matched chars map to the last replacement char
      if (tset.length) out += negated ? tset[tset.length - 1] : tset[Math.min(fset.indexOf(c), tset.length - 1)];
    } else out += c;
  }
  return out;
}
function expandTr(spec) {
  let out = ''; for (let i = 0; i < spec.length; i++) {
    if (spec[i + 1] === '-' && i + 2 < spec.length) { for (let c = spec.charCodeAt(i); c <= spec.charCodeAt(i + 2); c++) out += String.fromCharCode(c); i += 2; }
    else out += spec[i];
  } return out;
}
function strSlice(s, a) {
  const chars = [...s.value];
  if (a[0] instanceof RRange) { const [st, len] = rangeToSlice(a[0], chars.length); if (st === null) return null; return new RString(chars.slice(st, st + len).join('')); }
  if (a[0] instanceof RRegexp) { const m = s.value.match(new RegExp(a[0].re.source, a[0].re.flags.replace('g', ''))); gvars['$~'] = m ? mkMatchData(m, s.value) : null; if (!m) return null; const g = a[1] != null ? numVal(a[1]) : 0; return g < 0 ? (m[m.length + g] != null ? new RString(m[m.length + g]) : null) : (m[g] != null ? new RString(m[g]) : null); }
  if (a[0] instanceof RString) return s.value.includes(a[0].value) ? new RString(a[0].value) : null;
  let i = numVal(a[0]); if (i < 0) i += chars.length;
  if (a.length >= 2) { let len = numVal(a[1]); if (i < 0 || i > chars.length || len < 0) return null; return new RString(chars.slice(i, i + len).join('')); }
  if (i < 0 || i >= chars.length) return null;
  return new RString(chars[i]);
}
function strSliceSet(s, a) {
  checkFrozen(s);
  const val = jsstr(a[a.length - 1]);
  const chars = [...s.value];
  if (a[0] instanceof RRange) { const [st, len] = rangeToSlice(a[0], chars.length); const repl = [...val]; chars.splice(st, len, ...repl); s.value = chars.join(''); return a[a.length - 1]; }
  if (a[0] instanceof RString) { s.value = s.value.replace(a[0].value, val); return a[a.length - 1]; }
  let i = numVal(a[0]); if (i < 0) i += chars.length;
  const len = a.length >= 3 ? numVal(a[1]) : 1;
  chars.splice(i, len, ...[...val]);
  s.value = chars.join('');
  return a[a.length - 1];
}
function rangeToSlice(r, len) {
  let st = r.from === null ? 0 : numVal(r.from); if (st < 0) st += len;
  let en = r.to === null ? len : numVal(r.to); if (en < 0) en += len;
  if (!r.exclusive) en += 1;
  if (st < 0 || st > len) return [null, 0];
  return [st, Math.max(0, en - st)];
}

// ---- Symbol ---------------------------------------------------------------
function installSymbol() {
  const Y = SymbolC;
  def(Y, 'to_s', (s) => new RString(s.name));
  def(Y, 'id2name', (s) => new RString(s.name));
  def(Y, 'name', (s) => new RString(s.name));
  def(Y, 'to_sym', (s) => s);
  def(Y, 'to_proc', (s) => makeProc((args) => send(args[0], s.name, args.slice(1))));
  def(Y, 'inspect', (s) => new RString(inspect(s)));
  def(Y, '==', (s, a) => a[0] instanceof RSymbol && s.name === a[0].name);
  def(Y, '<=>', (s, a) => (a[0] instanceof RSymbol ? (s.name < a[0].name ? -1 : s.name > a[0].name ? 1 : 0) : null));
  def(Y, 'length', (s) => s.name.length);
  def(Y, 'size', (s) => s.name.length);
  def(Y, 'upcase', (s) => R.sym(s.name.toUpperCase()));
  def(Y, 'downcase', (s) => R.sym(s.name.toLowerCase()));
  def(Y, 'capitalize', (s) => R.sym(s.name.charAt(0).toUpperCase() + s.name.slice(1)));
  def(Y, 'empty?', (s) => s.name.length === 0);
  def(Y, '[]', (s, a) => strSlice(new RString(s.name), a));
  def(Y, 'succ', (s) => R.sym(strSucc(s.name)));
  def(Y, 'hash', (s) => { let h = 0; for (let i = 0; i < s.name.length; i++) h = (h * 31 + s.name.charCodeAt(i)) | 0; return h; });
  def(Y, 'start_with?', (s, a) => a.some((x) => s.name.startsWith(jsstr(x))));
}

// ---- Array ----------------------------------------------------------------
function installArray() {
  const A = ArrayC;
  const yieldEach = (arr, blk, fn) => { try { for (let i = 0; i < arr.length; i++) fn(i); } catch (e) { return brk(e); } };
  def(A, 'initialize', (s, a, blk) => { const n = a[0] != null ? numVal(a[0]) : 0; s.length = 0; for (let i = 0; i < n; i++) s.push(blk ? callBlock(blk, [i]) : (a[1] !== undefined ? a[1] : null)); return null; });
  sdef(A, 'new', (cls, a, blk) => {
    const out = [];
    if (cls !== ArrayC && cls instanceof RClass) out.rclass = cls;
    const init = findMethod(cls instanceof RClass ? cls : ArrayC, 'initialize');
    init(out, a, blk);
    return out;
  });
  sdef(A, '[]', (cls, a) => a.slice());
  def(A, '<<', (s, a) => { checkFrozen(s); s.push(a[0]); return s; });
  def(A, 'push', (s, a) => { checkFrozen(s); for (const x of a) s.push(x); return s; });
  def(A, 'append', A.methods.get('push'));
  def(A, 'pop', (s, a) => { checkFrozen(s); return a[0] != null ? s.splice(Math.max(0, s.length - numVal(a[0]))) : (s.length ? s.pop() : null); });
  def(A, 'shift', (s, a) => { checkFrozen(s); return a[0] != null ? s.splice(0, numVal(a[0])) : (s.length ? s.shift() : null); });
  def(A, 'unshift', (s, a) => { checkFrozen(s); s.unshift(...a); return s; });
  def(A, 'prepend', A.methods.get('unshift'));
  def(A, '[]', (s, a) => arrSlice(s, a));
  def(A, 'slice', (s, a) => arrSlice(s, a));
  def(A, 'at', (s, a) => { let i = numVal(a[0]); if (i < 0) i += s.length; return i >= 0 && i < s.length ? s[i] : null; });
  def(A, 'dig', (s, a) => arrDig(s, a));
  def(A, '[]=', (s, a) => arrSet(s, a));
  def(A, 'fetch', (s, a, blk) => { let i = numVal(a[0]); const orig = i; if (i < 0) i += s.length; if (i >= 0 && i < s.length) return s[i]; if (blk) return callBlock(blk, [a[0]]); if (a.length >= 2) return a[1]; raiseError(IndexErrorC, `index ${orig} outside of array bounds: ${-s.length}...${s.length}`); });
  def(A, 'first', (s, a) => (a[0] != null ? s.slice(0, numVal(a[0])) : (s.length ? s[0] : null)));
  def(A, 'last', (s, a) => (a[0] != null ? s.slice(Math.max(0, s.length - numVal(a[0]))) : (s.length ? s[s.length - 1] : null)));
  def(A, 'length', (s) => s.length);
  def(A, 'size', (s) => s.length);
  def(A, 'count', (s, a, blk) => { if (blk) { let n = 0; for (const x of s) if (truthy(callBlock(blk, [x]))) n++; return n; } if (a.length) { let n = 0; for (const x of s) if (rbEqual(x, a[0])) n++; return n; } return s.length; });
  def(A, 'empty?', (s) => s.length === 0);
  def(A, 'each', (s, a, blk) => { if (!blk) return mkEnum(function* () { yield* s; }); const r = yieldEach(s, blk, (i) => callBlock(blk, [s[i]])); return r !== undefined ? r : s; });
  def(A, 'each_with_index', (s, a, blk) => { if (!blk) return mkEnum(function* () { let i = 0; for (const x of s) yield [x, i++]; }); const r = yieldEach(s, blk, (i) => callBlock(blk, [s[i], i])); return r !== undefined ? r : s; });
  def(A, 'each_index', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (let i = 0; i < s.length; i++) yield i; }); const r = yieldEach(s, blk, (i) => callBlock(blk, [i])); return r !== undefined ? r : s; });
  def(A, 'each_with_object', (s, a, blk) => { const obj = a[0]; try { for (const x of s) callBlock(blk, [x, obj]); } catch (e) { return brk(e); } return obj; });
  def(A, 'reverse_each', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (let i = s.length - 1; i >= 0; i--) yield s[i]; }); try { for (let i = s.length - 1; i >= 0; i--) callBlock(blk, [s[i]]); } catch (e) { return brk(e); } return s; });
  def(A, 'map', (s, a, blk) => { if (!blk) return mkEnum(function* () { yield* s; }); const out = []; try { for (const x of s) out.push(callBlock(blk, [x])); } catch (e) { return brk(e); } return out; });
  def(A, 'collect', A.methods.get('map'));
  def(A, 'map!', (s, a, blk) => { checkFrozen(s); for (let i = 0; i < s.length; i++) s[i] = callBlock(blk, [s[i]]); return s; });
  def(A, 'collect!', A.methods.get('map!'));
  def(A, 'flat_map', (s, a, blk) => { const out = []; for (const x of s) { const r = callBlock(blk, [x]); if (Array.isArray(r)) out.push(...r); else out.push(r); } return out; });
  def(A, 'collect_concat', A.methods.get('flat_map'));
  def(A, 'select', (s, a, blk) => { const out = []; try { for (const x of s) if (truthy(callBlock(blk, [x]))) out.push(x); } catch (e) { return brk(e); } return out; });
  def(A, 'filter', A.methods.get('select'));
  def(A, 'select!', (s, a, blk) => { checkFrozen(s); const keep = s.filter((x) => truthy(callBlock(blk, [x]))); s.length = 0; s.push(...keep); return s; });
  def(A, 'filter!', A.methods.get('select!'));
  def(A, 'keep_if', A.methods.get('select!'));
  def(A, 'reject', (s, a, blk) => { const out = []; for (const x of s) if (!truthy(callBlock(blk, [x]))) out.push(x); return out; });
  def(A, 'reject!', (s, a, blk) => { checkFrozen(s); const keep = s.filter((x) => !truthy(callBlock(blk, [x]))); s.length = 0; s.push(...keep); return s; });
  def(A, 'delete_if', A.methods.get('reject!'));
  def(A, 'filter_map', (s, a, blk) => { const out = []; for (const x of s) { const r = callBlock(blk, [x]); if (truthy(r)) out.push(r); } return out; });
  def(A, 'find', (s, a, blk) => { for (const x of s) if (truthy(callBlock(blk, [x]))) return x; return null; });
  def(A, 'detect', A.methods.get('find'));
  def(A, 'find_index', (s, a, blk) => { for (let i = 0; i < s.length; i++) { if (blk ? truthy(callBlock(blk, [s[i]])) : rbEqual(s[i], a[0])) return i; } return null; });
  def(A, 'index', A.methods.get('find_index'));
  def(A, 'rindex', (s, a, blk) => { for (let i = s.length - 1; i >= 0; i--) { if (blk ? truthy(callBlock(blk, [s[i]])) : rbEqual(s[i], a[0])) return i; } return null; });
  def(A, 'find_all', A.methods.get('select'));
  def(A, 'include?', (s, a) => s.some((x) => rbEqual(x, a[0])));
  def(A, 'member?', A.methods.get('include?'));
  def(A, 'any?', (s, a, blk) => (blk ? s.some((x) => truthy(callBlock(blk, [x]))) : (a.length ? s.some((x) => truthy(send(a[0], '===', [x]))) : s.some(truthy))));
  def(A, 'all?', (s, a, blk) => (blk ? s.every((x) => truthy(callBlock(blk, [x]))) : (a.length ? s.every((x) => truthy(send(a[0], '===', [x]))) : s.every(truthy))));
  def(A, 'none?', (s, a, blk) => (blk ? !s.some((x) => truthy(callBlock(blk, [x]))) : !s.some(truthy)));
  def(A, 'one?', (s, a, blk) => { let n = 0; for (const x of s) if (blk ? truthy(callBlock(blk, [x])) : truthy(x)) n++; return n === 1; });
  def(A, 'min', (s, a, blk) => { if (a[0] != null) return s.slice().sort((x, y) => cmpWith(x, y, blk)).slice(0, numVal(a[0])); return s.length ? s.reduce((m, x) => (cmpWith(x, m, blk) < 0 ? x : m)) : null; });
  def(A, 'max', (s, a, blk) => { if (a[0] != null) return s.slice().sort((x, y) => cmpWith(y, x, blk)).slice(0, numVal(a[0])); return s.length ? s.reduce((m, x) => (cmpWith(x, m, blk) > 0 ? x : m)) : null; });
  def(A, 'min_by', (s, a, blk) => minMaxBy(s, blk, -1));
  def(A, 'max_by', (s, a, blk) => minMaxBy(s, blk, 1));
  def(A, 'minmax', (s) => [send(s, 'min', []), send(s, 'max', [])]);
  def(A, 'sum', (s, a, blk) => { let acc = a[0] != null ? a[0] : 0; for (const x of s) acc = send(acc, '+', [blk ? callBlock(blk, [x]) : x]); return acc; });
  def(A, 'reduce', (s, a, blk) => arrReduce(s, a, blk));
  def(A, 'inject', A.methods.get('reduce'));
  def(A, 'sort', (s, a, blk) => s.slice().sort((x, y) => (blk ? numVal(callBlock(blk, [x, y])) : spaceship(x, y))));
  def(A, 'sort!', (s, a, blk) => { checkFrozen(s); s.sort((x, y) => (blk ? numVal(callBlock(blk, [x, y])) : spaceship(x, y))); return s; });
  def(A, 'sort_by', (s, a, blk) => s.map((x) => [callBlock(blk, [x]), x]).sort((p, q) => spaceship(p[0], q[0])).map((p) => p[1]));
  def(A, 'sort_by!', (s, a, blk) => { const r = send(s, 'sort_by', a, blk); s.length = 0; s.push(...r); return s; });
  def(A, 'group_by', (s, a, blk) => { const h = new RHash(); for (const x of s) { const k = callBlock(blk, [x]); if (!h.has(k)) h.set(k, []); h.get(k).push(x); } return h; });
  def(A, 'partition', (s, a, blk) => { const t = [], f = []; for (const x of s) (truthy(callBlock(blk, [x])) ? t : f).push(x); return [t, f]; });
  def(A, 'chunk_while', (s, a, blk) => { if (!s.length) return []; const out = [[s[0]]]; for (let i = 1; i < s.length; i++) { if (truthy(callBlock(blk, [s[i - 1], s[i]]))) out[out.length - 1].push(s[i]); else out.push([s[i]]); } return out; });
  def(A, 'chunk', (s, a, blk) => { if (!blk) return mkEnum(function* () { yield* chunkArr(s, blk); }); return chunkArr(s, blk); });
  def(A, 'each_entry', (s, a, blk) => { if (!blk) return mkEnum(function* () { yield* s; }); try { for (const x of s) safeYield(blk, [x]); } catch (e) { return brk(e); } return s; });
  def(A, 'tally', (s) => { const h = new RHash(); for (const x of s) h.set(x, (h.get(x) || 0) + 1); return h; });
  def(A, 'reverse', (s) => s.slice().reverse());
  def(A, 'reverse!', (s) => { checkFrozen(s); s.reverse(); return s; });
  def(A, 'flatten', (s, a) => flatten(s, a[0] != null ? numVal(a[0]) : Infinity));
  def(A, 'flatten!', (s, a) => { checkFrozen(s); const f = flatten(s, a[0] != null ? numVal(a[0]) : Infinity); s.length = 0; s.push(...f); return s; });
  def(A, 'compact', (s) => s.filter((x) => x !== null));
  def(A, 'compact!', (s) => { checkFrozen(s); const f = s.filter((x) => x !== null); s.length = 0; s.push(...f); return s; });
  def(A, 'uniq', (s, a, blk) => arrUniq(s, blk));
  def(A, 'uniq!', (s, a, blk) => { checkFrozen(s); const u = arrUniq(s, blk); s.length = 0; s.push(...u); return s; });
  def(A, 'join', (s, a) => new RString(flatten(s, Infinity).map(toS).join(a[0] != null ? jsstr(a[0]) : '')));
  def(A, 'to_a', (s) => s);
  def(A, 'to_ary', (s) => s);
  def(A, 'entries', (s) => s.slice());
  def(A, 'to_h', (s, a, blk) => { const h = new RHash(); for (const x of s) { const pair = blk ? callBlock(blk, [x]) : x; h.set(pair[0], pair[1]); } return h; });
  def(A, 'concat', (s, a) => { for (const arr of a) s.push(...arr); return s; });
  def(A, '+', (s, a) => s.concat(a[0]));
  def(A, '-', (s, a) => s.filter((x) => !a[0].some((y) => rbEqual(x, y))));
  def(A, '*', (s, a) => { if (a[0] instanceof RString) return new RString(s.map(toS).join(a[0].value)); const out = []; for (let i = 0; i < numVal(a[0]); i++) out.push(...s); return out; });
  def(A, '&', (s, a) => arrUniq(s.filter((x) => a[0].some((y) => rbEqual(x, y))), null));
  def(A, '|', (s, a) => arrUniq(s.concat(a[0]), null));
  def(A, 'intersection', (s, a) => arrUniq(s.filter((x) => a.every((arr) => arr.some((y) => rbEqual(x, y)))), null));
  def(A, 'union', (s, a) => arrUniq(s.concat(...a), null));
  def(A, 'difference', (s, a) => s.filter((x) => !a.some((arr) => arr.some((y) => rbEqual(x, y)))));
  def(A, 'zip', (s, a) => s.map((x, i) => [x, ...a.map((arr) => (i < arr.length ? arr[i] : null))]));
  def(A, 'take', (s, a) => s.slice(0, numVal(a[0])));
  def(A, 'drop', (s, a) => s.slice(numVal(a[0])));
  def(A, 'take_while', (s, a, blk) => { const out = []; for (const x of s) { if (!truthy(callBlock(blk, [x]))) break; out.push(x); } return out; });
  def(A, 'drop_while', (s, a, blk) => { let i = 0; while (i < s.length && truthy(callBlock(blk, [s[i]]))) i++; return s.slice(i); });
  def(A, 'each_slice', (s, a, blk) => { const n = numVal(a[0]); const out = []; for (let i = 0; i < s.length; i += n) { const slice = s.slice(i, i + n); if (blk) callBlock(blk, [slice]); else out.push(slice); } return blk ? null : out; });
  def(A, 'each_cons', (s, a, blk) => { const n = numVal(a[0]); const out = []; for (let i = 0; i + n <= s.length; i++) { const slice = s.slice(i, i + n); if (blk) callBlock(blk, [slice]); else out.push(slice); } return blk ? s : out; });
  def(A, 'rotate', (s, a) => { const n = ((a[0] != null ? numVal(a[0]) : 1) % s.length + s.length) % (s.length || 1); return s.slice(n).concat(s.slice(0, n)); });
  def(A, 'sample', (s) => (s.length ? s[Math.floor(Math.random() * s.length)] : null));
  def(A, 'shuffle', (s) => { const c = s.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; });
  def(A, 'fill', (s, a, blk) => { checkFrozen(s); for (let i = 0; i < s.length; i++) s[i] = blk ? callBlock(blk, [i]) : a[0]; return s; });
  def(A, 'insert', (s, a) => { checkFrozen(s); let i = numVal(a[0]); if (i < 0) i += s.length + 1; s.splice(i, 0, ...a.slice(1)); return s; });
  def(A, 'delete', (s, a) => { checkFrozen(s); let found = null; for (let i = s.length - 1; i >= 0; i--) if (rbEqual(s[i], a[0])) { found = s[i]; s.splice(i, 1); } return found; });
  def(A, 'delete_at', (s, a) => { checkFrozen(s); let i = numVal(a[0]); if (i < 0) i += s.length; if (i < 0 || i >= s.length) return null; return s.splice(i, 1)[0]; });
  def(A, 'clear', (s) => { checkFrozen(s); s.length = 0; return s; });
  def(A, 'replace', (s, a) => { checkFrozen(s); s.length = 0; s.push(...a[0]); return s; });
  def(A, 'concat', A.methods.get('concat'));
  def(A, 'min', A.methods.get('min'));
  def(A, 'product', (s, a) => arrProduct([s, ...a]));
  def(A, 'combination', (s, a, blk) => { const res = combinations(s, numVal(a[0])); if (blk) { for (const c of res) callBlock(blk, [c]); return s; } return res; });
  def(A, 'permutation', (s, a, blk) => { const res = permutations(s, a[0] != null ? numVal(a[0]) : undefined); if (blk) { for (const c of res) callBlock(blk, [c]); return s; } return res; });
  def(A, 'slice_when', (s, a, blk) => { if (!s.length) return []; const out = [[s[0]]]; for (let i = 1; i < s.length; i++) { if (truthy(callBlock(blk, [s[i - 1], s[i]]))) out.push([s[i]]); else out[out.length - 1].push(s[i]); } return out; });
  def(A, 'transpose', (s) => (s.length === 0 ? [] : s[0].map((_, i) => s.map((row) => row[i]))));
  def(A, 'pack', (s, a) => rbPack(s, jsstr(a[0])));
  def(A, '==', (s, a) => rbEqual(s, a[0]));
  def(A, 'eql?', (s, a) => rbEqual(s, a[0]));
  def(A, '<=>', (s, a) => (Array.isArray(a[0]) ? spaceship(s, a[0]) : null));
  def(A, 'hash', (s) => { let h = 0; for (const x of s) h = (h * 31 + (numVal(send(x, 'hash', [])) | 0)) | 0; return h; });
  def(A, 'freeze', (s) => { s.__frozen = true; return s; });
  def(A, 'frozen?', (s) => !!s.__frozen);
  def(A, 'dup', (s) => s.slice());
  def(A, 'clone', (s) => s.slice());
  def(A, 'inspect', (s) => new RString(inspect(s)));
  def(A, 'to_s', (s) => new RString(inspect(s)));
  def(A, 'values_at', (s, a) => a.map((i) => { let n = numVal(i); if (n < 0) n += s.length; return s[n] ?? null; }));
  def(A, 'assoc', (s, a) => { for (const x of s) if (Array.isArray(x) && rbEqual(x[0], a[0])) return x; return null; });
  def(A, 'step', () => null);
  def(A, 'cycle', (s, a, blk) => { const n = a[0] != null ? numVal(a[0]) : Infinity; if (!blk) return mkEnum(function* () { if (s.length === 0) return; for (let c = 0; c < n; c++) yield* s; }); try { for (let c = 0; c < n; c++) for (const x of s) callBlock(blk, [x]); } catch (e) { return brk(e); } return null; });
  def(A, 'lazy', (s) => mkLazy(function* () { yield* s; }));
  def(A, 'force', (s) => s);
}

function cmpWith(x, m, blk) { return blk ? numVal(callBlock(blk, [x, m])) : spaceship(x, m); }
function minMaxBy(s, blk, dir) { if (!s.length) return null; let best = s[0], bk = callBlock(blk, [s[0]]); for (let i = 1; i < s.length; i++) { const k = callBlock(blk, [s[i]]); if (spaceship(k, bk) * dir > 0) { best = s[i]; bk = k; } } return best; }
function arrReduce(s, a, blk) {
  let acc, start = 0, sym = null;
  if (a.length === 2) { acc = a[0]; sym = a[1]; }
  else if (a.length === 1 && a[0] instanceof RSymbol) { sym = a[0]; acc = s[0]; start = 1; }
  else if (a.length === 1) { acc = a[0]; }
  else { acc = s[0]; start = 1; }
  for (let i = start; i < s.length; i++) acc = sym ? send(acc, sym.name, [s[i]]) : callBlock(blk, [acc, s[i]]);
  return acc === undefined ? null : acc;
}
function arrSlice(s, a) {
  if (a[0] instanceof RRange) { const [st, len] = rangeToSlice(a[0], s.length); if (st === null) return null; return s.slice(st, st + len); }
  let i = numVal(a[0]); if (i < 0) i += s.length;
  if (a.length >= 2) { const len = numVal(a[1]); if (i < 0 || i > s.length || len < 0) return null; return s.slice(i, i + len); }
  if (i < 0 || i >= s.length) return null;
  return s[i];
}
function arrSet(s, a) {
  checkFrozen(s);
  const val = a[a.length - 1];
  if (a[0] instanceof RRange) { const [st, len] = rangeToSlice(a[0], s.length); s.splice(st, len, ...(Array.isArray(val) ? val : [val])); return val; }
  if (a.length >= 3) { let i = numVal(a[0]); if (i < 0) i += s.length; const len = numVal(a[1]); s.splice(i, len, ...(Array.isArray(val) ? val : [val])); return val; }
  let i = numVal(a[0]); if (i < 0) i += s.length;
  while (s.length < i) s.push(null);
  s[i] = val; return val;
}
function arrDig(s, a) { let cur = s; for (const k of a) { if (cur === null) return null; cur = send(cur, '[]', [k]); } return cur; }
function flatten(arr, depth) { const out = []; for (const x of arr) { if (Array.isArray(x) && depth > 0) out.push(...flatten(x, depth - 1)); else out.push(x); } return out; }
// pack/unpack: parse a template into [directive, count] tokens. count is a
// number, '*' (greedy), or 1 (default). Whitespace and comments are skipped.
function packTemplate(fmt) { const toks = []; const re = /([a-zA-Z@])\s*(\d+|\*)?/g; let m; while ((m = re.exec(fmt))) toks.push([m[1], m[2] === undefined ? 1 : (m[2] === '*' ? '*' : parseInt(m[2], 10))]); return toks; }
function pushInt(bytes, val, size, little) { const b = []; let v = BigInt(val) & ((1n << BigInt(size * 8)) - 1n); for (let i = 0; i < size; i++) { b.push(Number(v & 0xffn)); v >>= 8n; } if (!little) b.reverse(); for (const x of b) bytes.push(x); }
function rbPack(arr, fmt) {
  const bytes = []; let ai = 0;
  for (const [d, cnt] of packTemplate(fmt)) {
    if ('aAZ'.includes(d)) { const str = arr[ai++]; const sv = str == null ? '' : jsstr(str); const buf = []; for (let i = 0; i < sv.length; i++) buf.push(sv.charCodeAt(i) & 0xff); let n = cnt === '*' ? buf.length + (d === 'Z' ? 1 : 0) : cnt; const pad = d === 'A' ? 0x20 : 0; for (let i = 0; i < n; i++) bytes.push(i < buf.length ? buf[i] : pad); continue; }
    if ('Hh'.includes(d)) { const sv = jsstr(arr[ai++]); const n = cnt === '*' ? sv.length : cnt; for (let i = 0; i < n; i += 2) { const hi = parseInt(sv[i] || '0', 16) || 0; const lo = parseInt(sv[i + 1] || '0', 16) || 0; bytes.push(d === 'H' ? (hi << 4) | lo : (lo << 4) | hi); } continue; }
    const count = cnt === '*' ? arr.length - ai : cnt;
    for (let i = 0; i < count; i++) {
      const v = arr[ai++];
      switch (d) {
        case 'C': case 'c': bytes.push(numVal(v) & 0xff); break;
        case 'U': { for (const b of Buffer.from(String.fromCodePoint(numVal(v)), 'utf8')) bytes.push(b); break; }
        case 's': case 'S': case 'v': pushInt(bytes, numVal(v), 2, true); break;
        case 'n': pushInt(bytes, numVal(v), 2, false); break;
        case 'l': case 'L': case 'V': pushInt(bytes, numVal(v), 4, true); break;
        case 'N': pushInt(bytes, numVal(v), 4, false); break;
        case 'Q': case 'q': pushInt(bytes, numVal(v), 8, true); break;
        default: ai--; i = count; break;
      }
    }
  }
  return new RString(bytes.map((b) => String.fromCharCode(b)).join(''));
}
function readInt(bytes, off, size, little, signed) { let v = 0n; for (let i = 0; i < size; i++) { const b = BigInt(bytes[off + (little ? i : size - 1 - i)] || 0); v |= b << BigInt(i * 8); } if (signed && (v & (1n << BigInt(size * 8 - 1)))) v -= 1n << BigInt(size * 8); return Number(v); }
function rbUnpack(str, fmt) {
  // latin1 byte view: each JS char contributes one byte (consistent with rbPack).
  const bytes = []; for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  const out = []; let pos = 0;
  for (const [d, cnt] of packTemplate(fmt)) {
    if ('aAZ'.includes(d)) { const n = cnt === '*' ? bytes.length - pos : cnt; const slice = bytes.slice(pos, pos + n); pos += n; let sv = slice.map((b) => String.fromCharCode(b)).join(''); if (d === 'A') sv = sv.replace(/[ \0]+$/, ''); else if (d === 'Z') { const z = sv.indexOf('\0'); if (z >= 0) sv = sv.slice(0, z); } out.push(new RString(sv)); continue; }
    if (d === 'U') { const cps = [...str]; const n = cnt === '*' ? cps.length : cnt; for (let i = 0; i < n && i < cps.length; i++) out.push(cps[i].codePointAt(0)); continue; }
    if ('Hh'.includes(d)) { const n = cnt === '*' ? (bytes.length - pos) * 2 : cnt; let hex = ''; for (let i = 0; i < n; i++) { const b = bytes[pos + (i >> 1)]; if (b === undefined) break; const nib = (i % 2 === 0) === (d === 'H') ? (b >> 4) : (b & 0xf); hex += nib.toString(16); } pos += Math.ceil(n / 2); out.push(new RString(hex)); continue; }
    const sizes = { C: [1, 0, 0], c: [1, 0, 1], n: [2, 0, 0], v: [2, 1, 0], S: [2, 1, 0], s: [2, 1, 1], N: [4, 0, 0], V: [4, 1, 0], L: [4, 1, 0], l: [4, 1, 1], Q: [8, 1, 0], q: [8, 1, 1] };
    const spec = sizes[d]; if (!spec) continue; const [size, little, signed] = spec;
    const count = cnt === '*' ? Math.floor((bytes.length - pos) / size) : cnt;
    for (let i = 0; i < count; i++) { if (pos + size > bytes.length && cnt !== '*') { out.push(null); continue; } out.push(readInt(bytes, pos, size, little, signed)); pos += size; }
  }
  return out;
}
function arrUniq(arr, blk) { const seen = new Set(); const out = []; for (const x of arr) { const k = hashKey(blk ? callBlock(blk, [x]) : x); if (!seen.has(k)) { seen.add(k); out.push(x); } } return out; }
function arrProduct(arrays) { let result = [[]]; for (const arr of arrays) { const next = []; for (const combo of result) for (const item of arr) next.push([...combo, item]); result = next; } return result; }
function combinations(arr, k) { if (k === 0) return [[]]; if (k > arr.length) return []; const out = []; const rec = (start, combo) => { if (combo.length === k) { out.push(combo.slice()); return; } for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop(); } }; rec(0, []); return out; }
// Group consecutive elements sharing a block-computed key (MRI Enumerable#chunk).
function chunkArr(arr, blk) { const out = []; let key, cur, started = false; for (const x of arr) { const k = callBlock(blk, [x]); if (started && rbEqual(k, key)) cur.push(x); else { if (started) out.push([key, cur]); key = k; cur = [x]; started = true; } } if (started) out.push([key, cur]); return out; }
function permutations(arr, k) { if (k === undefined) k = arr.length; if (k < 0 || k > arr.length) return []; const out = []; const used = new Array(arr.length).fill(false); const cur = []; const rec = () => { if (cur.length === k) { out.push(cur.slice()); return; } for (let i = 0; i < arr.length; i++) { if (used[i]) continue; used[i] = true; cur.push(arr[i]); rec(); cur.pop(); used[i] = false; } }; rec(); return out; }

// ---- Hash -----------------------------------------------------------------
function installHash() {
  const H = HashC;
  def(H, 'initialize', (s, a, blk) => { if (blk) s.defaultProc = blk; else if (a.length) s.defaultValue = a[0]; return null; });
  sdef(H, 'new', (cls, a, blk) => {
    const h = new RHash();
    if (cls !== HashC && cls instanceof RClass) h.rclass = cls;
    const init = findMethod(cls instanceof RClass ? cls : HashC, 'initialize');
    init(h, a, blk);
    return h;
  });
  sdef(H, '[]', (cls, a) => { const h = new RHash(); if (a.length === 1 && a[0] instanceof RHash) { for (const [k, v] of a[0].entries()) h.set(k, v); } else if (a.length === 1 && Array.isArray(a[0])) { for (const pair of a[0]) h.set(pair[0], pair[1]); } else { for (let i = 0; i + 1 < a.length; i += 2) h.set(a[i], a[i + 1]); } return h; });
  def(H, '[]', (s, a) => { const e = s.map.get(hashKey(a[0])); if (e) return e.value; if (s.defaultProc) return callBlock(s.defaultProc, [s, a[0]]); return s.defaultValue; });
  def(H, '[]=', (s, a) => { checkFrozen(s); s.set(a[0], a[1]); return a[1]; });
  def(H, 'store', (s, a) => { checkFrozen(s); s.set(a[0], a[1]); return a[1]; });
  def(H, 'fetch', (s, a, blk) => { const e = s.map.get(hashKey(a[0])); if (e) return e.value; if (blk) return callBlock(blk, [a[0]]); if (a.length >= 2) return a[1]; raiseError(KeyErrorC, `key not found: ${inspect(a[0])}`); });
  def(H, 'dig', (s, a) => { let cur = s; for (const k of a) { if (cur === null) return null; cur = send(cur, '[]', [k]); } return cur; });
  def(H, 'key?', (s, a) => s.has(a[0]));
  def(H, 'has_key?', H.methods.get('key?'));
  def(H, 'include?', H.methods.get('key?'));
  def(H, 'member?', H.methods.get('key?'));
  def(H, 'value?', (s, a) => s.values().some((v) => rbEqual(v, a[0])));
  def(H, 'has_value?', H.methods.get('value?'));
  def(H, 'keys', (s) => s.keys());
  def(H, 'values', (s) => s.values());
  def(H, 'values_at', (s, a) => a.map((k) => (s.has(k) ? s.get(k) : s.defaultValue)));
  def(H, 'length', (s) => s.size);
  def(H, 'size', (s) => s.size);
  def(H, 'count', (s, a, blk) => { if (blk) { let n = 0; for (const [k, v] of s.entries()) if (truthy(callBlock(blk, [k, v]))) n++; return n; } return s.size; });
  def(H, 'empty?', (s) => s.size === 0);
  def(H, 'each', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (const [k, v] of [...s.entries()]) yield [k, v]; }); try { for (const [k, v] of [...s.entries()]) callBlock(blk, [k, v]); } catch (e) { return brk(e); } return s; });
  def(H, 'each_pair', H.methods.get('each'));
  def(H, 'each_key', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (const k of s.keys()) yield k; }); try { for (const k of s.keys()) callBlock(blk, [k]); } catch (e) { return brk(e); } return s; });
  def(H, 'each_value', (s, a, blk) => { if (!blk) return mkEnum(function* () { for (const v of s.values()) yield v; }); try { for (const v of s.values()) callBlock(blk, [v]); } catch (e) { return brk(e); } return s; });
  def(H, 'each_with_index', (s, a, blk) => { if (!blk) return mkEnum(function* () { let i = 0; for (const [k, v] of s.entries()) yield [[k, v], i++]; }); let i = 0; try { for (const [k, v] of s.entries()) callBlock(blk, [[k, v], i++]); } catch (e) { return brk(e); } return s; });
  def(H, 'each_with_object', (s, a, blk) => { const obj = a[0]; try { for (const [k, v] of s.entries()) callBlock(blk, [[k, v], obj]); } catch (e) { return brk(e); } return obj; });
  def(H, 'map', (s, a, blk) => { const out = []; for (const [k, v] of s.entries()) out.push(callBlock(blk, [k, v])); return out; });
  def(H, 'collect', H.methods.get('map'));
  def(H, 'flat_map', (s, a, blk) => { const out = []; for (const [k, v] of s.entries()) { const r = callBlock(blk, [k, v]); if (Array.isArray(r)) out.push(...r); else out.push(r); } return out; });
  def(H, 'select', (s, a, blk) => { const h = new RHash(); for (const [k, v] of s.entries()) if (truthy(callBlock(blk, [k, v]))) h.set(k, v); return h; });
  def(H, 'filter', H.methods.get('select'));
  def(H, 'reject', (s, a, blk) => { const h = new RHash(); for (const [k, v] of s.entries()) if (!truthy(callBlock(blk, [k, v]))) h.set(k, v); return h; });
  def(H, 'compact', (s) => { const h = new RHash(); for (const [k, v] of s.entries()) if (v !== null && v !== undefined) h.set(k, v); return h; });
  def(H, 'compact!', (s) => { checkFrozen(s); let changed = false; for (const [k, v] of [...s.entries()]) if (v === null || v === undefined) { s.delete(k); changed = true; } return changed ? s : null; });
  def(H, 'filter_map', (s, a, blk) => { const out = []; for (const [k, v] of s.entries()) { const r = callBlock(blk, [k, v]); if (truthy(r)) out.push(r); } return out; });
  def(H, 'find', (s, a, blk) => { for (const [k, v] of s.entries()) if (truthy(callBlock(blk, [k, v]))) return [k, v]; return null; });
  def(H, 'detect', H.methods.get('find'));
  def(H, 'any?', (s, a, blk) => { if (!blk) return s.size > 0; for (const [k, v] of s.entries()) if (truthy(callBlock(blk, [k, v]))) return true; return false; });
  def(H, 'all?', (s, a, blk) => { for (const [k, v] of s.entries()) if (!truthy(callBlock(blk, [k, v]))) return false; return true; });
  def(H, 'none?', (s, a, blk) => { for (const [k, v] of s.entries()) if (truthy(callBlock(blk, [k, v]))) return false; return true; });
  def(H, 'sum', (s, a, blk) => { let acc = a[0] != null ? a[0] : 0; for (const [k, v] of s.entries()) acc = send(acc, '+', [callBlock(blk, [k, v])]); return acc; });
  def(H, 'reduce', (s, a, blk) => arrReduce([...s.entries()], a, blk));
  def(H, 'inject', H.methods.get('reduce'));
  def(H, 'min_by', (s, a, blk) => minMaxBy([...s.entries()], blk, -1));
  def(H, 'max_by', (s, a, blk) => minMaxBy([...s.entries()], blk, 1));
  def(H, 'sort_by', (s, a, blk) => [...s.entries()].map((e) => [callBlock(blk, e), e]).sort((p, q) => spaceship(p[0], q[0])).map((p) => p[1]));
  def(H, 'sort', (s) => [...s.entries()].sort((p, q) => spaceship(p[0], q[0])));
  def(H, 'group_by', (s, a, blk) => { const h = new RHash(); for (const [k, v] of s.entries()) { const gk = callBlock(blk, [k, v]); if (!h.has(gk)) h.set(gk, []); h.get(gk).push([k, v]); } return h; });
  def(H, 'partition', (s, a, blk) => { const t = [], f = []; for (const [k, v] of s.entries()) (truthy(callBlock(blk, [k, v])) ? t : f).push([k, v]); return [t, f]; });
  def(H, 'merge', (s, a, blk) => { const h = new RHash(); for (const [k, v] of s.entries()) h.set(k, v); for (const o of a) for (const [k, v] of o.entries()) { if (blk && h.has(k)) h.set(k, callBlock(blk, [k, h.get(k), v])); else h.set(k, v); } return h; });
  def(H, 'merge!', (s, a, blk) => { checkFrozen(s); for (const o of a) for (const [k, v] of o.entries()) { if (blk && s.has(k)) s.set(k, callBlock(blk, [k, s.get(k), v])); else s.set(k, v); } return s; });
  def(H, 'update', H.methods.get('merge!'));
  def(H, 'delete', (s, a, blk) => { checkFrozen(s); if (s.has(a[0])) return s.delete(a[0]); return blk ? callBlock(blk, [a[0]]) : null; });
  def(H, 'delete_if', (s, a, blk) => { checkFrozen(s); for (const k of s.keys()) if (truthy(callBlock(blk, [k, s.get(k)]))) s.delete(k); return s; });
  def(H, 'reject!', H.methods.get('delete_if'));
  def(H, 'keep_if', (s, a, blk) => { checkFrozen(s); for (const k of s.keys()) if (!truthy(callBlock(blk, [k, s.get(k)]))) s.delete(k); return s; });
  def(H, 'select!', H.methods.get('keep_if'));
  def(H, 'clear', (s) => { checkFrozen(s); s.map.clear(); return s; });
  def(H, 'to_a', (s) => [...s.entries()].map(([k, v]) => [k, v]));
  def(H, 'to_h', (s, a, blk) => { if (!blk) return s; const h = new RHash(); for (const [k, v] of s.entries()) { const pair = callBlock(blk, [k, v]); h.set(pair[0], pair[1]); } return h; });
  def(H, 'invert', (s) => { const h = new RHash(); for (const [k, v] of s.entries()) h.set(v, k); return h; });
  def(H, 'key', (s, a) => { for (const [k, v] of s.entries()) if (rbEqual(v, a[0])) return k; return null; });
  def(H, 'transform_values', (s, a, blk) => { const h = new RHash(); for (const [k, v] of s.entries()) h.set(k, callBlock(blk, [v])); return h; });
  def(H, 'transform_keys', (s, a, blk) => { const h = new RHash(); for (const [k, v] of s.entries()) h.set(blk ? callBlock(blk, [k]) : k, v); return h; });
  def(H, 'transform_values!', (s, a, blk) => { for (const [k, v] of [...s.entries()]) s.set(k, callBlock(blk, [v])); return s; });
  def(H, 'slice', (s, a) => { const h = new RHash(); for (const k of a) if (s.has(k)) h.set(k, s.get(k)); return h; });
  def(H, 'except', (s, a) => { const h = new RHash(); for (const [k, v] of s.entries()) if (!a.some((x) => rbEqual(x, k))) h.set(k, v); return h; });
  def(H, 'fetch_values', (s, a) => a.map((k) => send(s, 'fetch', [k])));
  def(H, 'default', (s) => s.defaultValue);
  def(H, 'default=', (s, a) => { s.defaultValue = a[0]; return a[0]; });
  def(H, 'default_proc', (s) => s.defaultProc || null);
  def(H, 'default_proc=', (s, a) => { s.defaultProc = a[0]; return a[0]; });
  def(H, 'to_proc', (s) => makeProc((args) => send(s, '[]', [args[0]])));
  def(H, '==', (s, a) => rbEqual(s, a[0]));
  def(H, 'hash', (s) => s.size);
  def(H, 'freeze', (s) => { s.__frozen = true; return s; });
  def(H, 'frozen?', (s) => !!s.__frozen);
  def(H, 'dup', (s) => { const h = new RHash(); for (const [k, v] of s.entries()) h.set(k, v); return h; });
  def(H, 'inspect', (s) => new RString(inspect(s)));
  def(H, 'to_s', (s) => new RString(inspect(s)));
  def(H, 'first', (s, a) => { const arr = [...s.entries()]; return a[0] != null ? arr.slice(0, numVal(a[0])) : (arr.length ? arr[0] : null); });
  def(H, 'min_by', H.methods.get('min_by'));
}

// ---- Range ----------------------------------------------------------------
function installRange() {
  const R_ = RangeC;
  def(R_, 'each', (s, a, blk) => { if (!blk) return mkEnum(function* () { yield* rangeToArray(s); }); try { for (const x of rangeToArray(s)) safeYield(blk, [x]); } catch (e) { return brk(e); } return s; });
  def(R_, 'lazy', (s) => mkLazy(function* () { if (isInt(s.from)) { const end = s.to === null ? Infinity : numVal(s.to); for (let i = s.from; s.exclusive ? i < end : i <= end; i++) yield i; } else { yield* rangeToArray(s); } }));
  def(R_, 'to_a', (s) => rangeToArray(s));
  def(R_, 'to_ary', (s) => rangeToArray(s));
  def(R_, 'entries', (s) => rangeToArray(s));
  def(R_, 'map', (s, a, blk) => { if (!blk) return mkEnum(function* () { yield* rangeToArray(s); }); const out = []; try { for (const x of rangeToArray(s)) out.push(callBlock(blk, [x])); } catch (e) { return brk(e); } return out; });
  def(R_, 'collect', R_.methods.get('map'));
  def(R_, 'flat_map', (s, a, blk) => { const out = []; for (const x of rangeToArray(s)) { const r = callBlock(blk, [x]); Array.isArray(r) ? out.push(...r) : out.push(r); } return out; });
  def(R_, 'select', (s, a, blk) => rangeToArray(s).filter((x) => truthy(callBlock(blk, [x]))));
  def(R_, 'filter', R_.methods.get('select'));
  def(R_, 'reject', (s, a, blk) => rangeToArray(s).filter((x) => !truthy(callBlock(blk, [x]))));
  def(R_, 'find', (s, a, blk) => { for (const x of rangeToArray(s)) if (truthy(callBlock(blk, [x]))) return x; return null; });
  def(R_, 'detect', R_.methods.get('find'));
  def(R_, 'each_with_index', (s, a, blk) => { if (!blk) return mkEnum(function* () { let i = 0; for (const x of rangeToArray(s)) yield [x, i++]; }); let i = 0; for (const x of rangeToArray(s)) callBlock(blk, [x, i++]); return s; });
  def(R_, 'chunk', (s, a, blk) => { if (!blk) return mkEnum(function* () { yield* chunkArr(rangeToArray(s), blk); }); return chunkArr(rangeToArray(s), blk); });
  def(R_, 'each_with_object', (s, a, blk) => { const obj = a[0]; for (const x of rangeToArray(s)) callBlock(blk, [x, obj]); return obj; });
  def(R_, 'include?', (s, a) => rangeInclude(s, a[0]));
  def(R_, 'member?', R_.methods.get('include?'));
  def(R_, 'cover?', R_.methods.get('include?'));
  def(R_, '===', R_.methods.get('include?'));
  def(R_, 'first', (s, a) => { if (a[0] == null) return s.from; const n = numVal(a[0]); if (isInt(s.from)) { const out = []; for (let i = s.from; out.length < n && (s.to === null || (s.exclusive ? i < s.to : i <= s.to)); i++) out.push(i); return out; } return rangeToArray(s).slice(0, n); });
  def(R_, 'last', (s, a) => (a[0] != null ? rangeToArray(s).slice(-numVal(a[0])) : s.to));
  def(R_, 'begin', (s) => s.from);
  def(R_, 'end', (s) => s.to);
  def(R_, 'min', (s) => s.from);
  def(R_, 'max', (s) => (s.exclusive && isInt(s.to) ? s.to - 1 : s.to));
  def(R_, 'size', (s) => { if (!isNum(s.from)) return null; const lo = numVal(s.from), hi = numVal(s.to); const n = Math.floor(hi) - Math.ceil(lo) + (s.exclusive ? 0 : 1); return Math.max(0, n); });
  def(R_, 'count', (s, a, blk) => { if (blk) return rangeToArray(s).filter((x) => truthy(callBlock(blk, [x]))).length; return send(s, 'size', []); });
  def(R_, 'length', R_.methods.get('size'));
  def(R_, 'sum', (s, a, blk) => { let acc = a[0] != null ? a[0] : 0; for (const x of rangeToArray(s)) acc = send(acc, '+', [blk ? callBlock(blk, [x]) : x]); return acc; });
  def(R_, 'reduce', (s, a, blk) => arrReduce(rangeToArray(s), a, blk));
  def(R_, 'inject', R_.methods.get('reduce'));
  def(R_, 'step', (s, a, blk) => { const by = numVal(a[0]); const lo = numVal(s.from), hi = numVal(s.to); const out = []; for (let i = lo; s.exclusive ? i < hi : i <= hi; i += by) { if (blk) safeYield(blk, [isInt(s.from) && isInt(a[0]) ? i : mkfloat(i)]); else out.push(i); } return blk ? s : out; });
  def(R_, 'exclude_end?', (s) => s.exclusive);
  def(R_, 'reverse_each', (s, a, blk) => { const arr = rangeToArray(s); for (let i = arr.length - 1; i >= 0; i--) callBlock(blk, [arr[i]]); return s; });
  def(R_, 'to_s', (s) => new RString(toS(s.from) + (s.exclusive ? '...' : '..') + toS(s.to)));
  def(R_, 'inspect', (s) => new RString(inspect(s)));
  def(R_, 'min_by', (s, a, blk) => minMaxBy(rangeToArray(s), blk, -1));
  def(R_, 'max_by', (s, a, blk) => minMaxBy(rangeToArray(s), blk, 1));
  def(R_, 'sort_by', (s, a, blk) => send(rangeToArray(s), 'sort_by', a, blk));
  def(R_, 'group_by', (s, a, blk) => send(rangeToArray(s), 'group_by', a, blk));
  def(R_, 'partition', (s, a, blk) => send(rangeToArray(s), 'partition', a, blk));
  def(R_, 'all?', (s, a, blk) => send(rangeToArray(s), 'all?', a, blk));
  def(R_, 'any?', (s, a, blk) => send(rangeToArray(s), 'any?', a, blk));
  def(R_, 'none?', (s, a, blk) => send(rangeToArray(s), 'none?', a, blk));
  def(R_, 'each_slice', (s, a, blk) => send(rangeToArray(s), 'each_slice', a, blk));
  def(R_, 'each_cons', (s, a, blk) => send(rangeToArray(s), 'each_cons', a, blk));
  def(R_, 'zip', (s, a) => send(rangeToArray(s), 'zip', a));
  def(R_, 'take', (s, a) => rangeToArray(s).slice(0, numVal(a[0])));
  def(R_, 'drop', (s, a) => rangeToArray(s).slice(numVal(a[0])));
  def(R_, '==', (s, a) => rbEqual(s, a[0]));
}
function rangeInclude(s, x) {
  if (isNum(x) && (s.from === null || isNum(s.from)) && (s.to === null || isNum(s.to))) {
    const v = numVal(x); const lo = s.from === null ? -Infinity : numVal(s.from); const hi = s.to === null ? Infinity : numVal(s.to);
    return v >= lo && (s.exclusive ? v < hi : v <= hi);
  }
  if (x instanceof RString && (s.from === null || s.from instanceof RString) && (s.to === null || s.to instanceof RString)) {
    const lo = s.from === null ? null : s.from.value; const hi = s.to === null ? null : s.to.value;
    return (lo === null || x.value >= lo) && (hi === null || (s.exclusive ? x.value < hi : x.value <= hi));
  }
  return false;
}

// ---- pattern matching (`case/in`) -----------------------------------------
// Match `value` against descriptor `d`, recording bindings into `binds`.
function patMatch(value, d, binds) {
  switch (d.k) {
    case 'val': return truthy(send(d.f(), '===', [value]));
    case 'var': binds[d.n] = value; return true;
    case 'bind': if (!patMatch(value, d.p, binds)) return false; binds[d.n] = value; return true;
    case 'alt': for (const o of d.opts) if (patMatch(value, o, binds)) return true; return false;
    case 'arr': return matchArrayPattern(value, d, binds);
    case 'find': return matchFindPattern(value, d, binds);
    case 'hash': return matchHashPattern(value, d, binds);
  }
  return false;
}
function patDeconstruct(value, constThunk) {
  if (constThunk && !truthy(send(value, 'is_a?', [constThunk()]))) return null;
  if (Array.isArray(value)) return value;
  if (respondTo(value, 'deconstruct')) { const a = send(value, 'deconstruct', []); return Array.isArray(a) ? a : null; }
  return null;
}
function matchArrayPattern(value, d, binds) {
  const arr = patDeconstruct(value, d.c);
  if (!arr) return false;
  const need = d.pre.length + d.post.length;
  if (d.hasRest ? arr.length < need : arr.length !== need) return false;
  for (let i = 0; i < d.pre.length; i++) if (!patMatch(arr[i], d.pre[i], binds)) return false;
  for (let i = 0; i < d.post.length; i++) if (!patMatch(arr[arr.length - d.post.length + i], d.post[i], binds)) return false;
  if (d.hasRest && d.restName) binds[d.restName] = arr.slice(d.pre.length, arr.length - d.post.length);
  return true;
}
function matchFindPattern(value, d, binds) {
  const arr = patDeconstruct(value, d.c);
  if (!arr) return false;
  const m = d.mid.length;
  for (let start = 0; start + m <= arr.length; start++) {
    const tmp = {}; let ok = true;
    for (let i = 0; i < m; i++) if (!patMatch(arr[start + i], d.mid[i], tmp)) { ok = false; break; }
    if (ok) {
      Object.assign(binds, tmp);
      if (d.preName) binds[d.preName] = arr.slice(0, start);
      if (d.postName) binds[d.postName] = arr.slice(start + m);
      return true;
    }
  }
  return false;
}
function matchHashPattern(value, d, binds) {
  const keySyms = d.pairs.map((p) => R.sym(p.key));
  const keysArg = d.restKind === 'rest' ? null : keySyms;
  let h;
  if (d.c && !truthy(send(value, 'is_a?', [d.c()]))) return false;
  if (value instanceof RHash) h = value;
  else if (respondTo(value, 'deconstruct_keys')) { const r = send(value, 'deconstruct_keys', [keysArg]); if (!(r instanceof RHash)) return false; h = r; }
  else return false;
  for (const p of d.pairs) {
    const sym = R.sym(p.key);
    if (!h.has(sym)) return false;
    const v = h.get(sym);
    if (p.val) { if (!patMatch(v, p.val, binds)) return false; }
    else binds[p.key] = v;
  }
  if (d.restKind === 'nil') { if (h.size !== d.pairs.length) return false; }
  else if (d.restKind === 'rest' && d.restName) {
    const rest = new RHash(); const used = new Set(d.pairs.map((p) => hashKey(R.sym(p.key))));
    for (const [k, vv] of h.entries()) if (!used.has(hashKey(k))) rest.set(k, vv);
    binds[d.restName] = rest;
  }
  return true;
}

// ---- Proc -----------------------------------------------------------------
function installProc() {
  const P = ProcC;
  def(P, 'call', (s, a, blk) => callProc(s, a, blk));
  def(P, '()', (s, a, blk) => callProc(s, a, blk));
  def(P, '[]', (s, a, blk) => callProc(s, a, blk));
  def(P, 'yield', (s, a, blk) => callProc(s, a, blk));
  def(P, '===', (s, a) => truthy(callProc(s, [a[0]])));
  def(P, 'to_proc', (s) => s);
  def(P, 'lambda?', (s) => s.isLambda);
  def(P, 'arity', (s) => (s.arity != null ? s.arity : -1));
  def(P, 'curry', (s) => s);
  def(P, 'inspect', (s) => new RString('#<Proc' + (s.isLambda ? ' (lambda)' : '') + '>'));
  def(P, 'to_s', P.methods.get('inspect'));
  sdef(P, 'new', (cls, a, blk) => blk);
}
function callProc(s, a, blk) {
  if (s.isLambda) {
    // A lambda's own `return`/`next` is caught inside its compiled body (frame
    // match); only `next` (NextError) escapes to here. A ReturnError reaching
    // this point belongs to an outer method, so let it propagate.
    try { return s.fn(a, undefined); }
    catch (e) { if (e instanceof NextError) return e.value; throw e; }
  }
  return s.fn(a, undefined);
}

// ---- nil / true / false ---------------------------------------------------
function installNilTrueFalse() {
  def(NilClassC, 'to_s', () => new RString(''));
  def(NilClassC, 'to_a', () => []);
  def(NilClassC, 'to_h', () => new RHash());
  def(NilClassC, 'to_i', () => 0);
  def(NilClassC, 'to_f', () => mkfloat(0));
  def(NilClassC, 'inspect', () => new RString('nil'));
  def(NilClassC, 'nil?', () => true);
  def(NilClassC, '!', () => true);
  def(NilClassC, '&', (s, a) => false);
  def(NilClassC, '|', (s, a) => truthy(a[0]));
  def(NilClassC, '^', (s, a) => truthy(a[0]));
  def(NilClassC, '==', (s, a) => a[0] === null);
  def(NilClassC, 'class', () => NilClassC);

  for (const [C, name, val] of [[TrueClassC, 'true', true], [FalseClassC, 'false', false]]) {
    def(C, 'to_s', () => new RString(name));
    def(C, 'inspect', () => new RString(name));
    def(C, '!', () => !val);
    def(C, '&', (s, a) => val && truthy(a[0]));
    def(C, '|', (s, a) => val || truthy(a[0]));
    def(C, '^', (s, a) => val !== truthy(a[0]));
    def(C, '==', (s, a) => a[0] === val);
  }
}

// ---- Comparable / Enumerable ---------------------------------------------
function installComparable() {
  const C = ComparableC;
  const cmp = (s, o) => { const r = send(s, '<=>', [o]); if (r === null) raiseError(ArgumentErrorC, `comparison of ${classOf(s).name} with ${classOf(o).name} failed`); return numVal(r); };
  def(C, '<', (s, a) => cmp(s, a[0]) < 0);
  def(C, '>', (s, a) => cmp(s, a[0]) > 0);
  def(C, '<=', (s, a) => cmp(s, a[0]) <= 0);
  def(C, '>=', (s, a) => cmp(s, a[0]) >= 0);
  def(C, '==', (s, a) => { const r = send(s, '<=>', [a[0]]); return r !== null && numVal(r) === 0; });
  def(C, 'between?', (s, a) => cmp(s, a[0]) >= 0 && cmp(s, a[1]) <= 0);
  def(C, 'clamp', (s, a) => { let lo, hi; if (a[0] instanceof RRange) { lo = a[0].from; hi = a[0].to; } else { lo = a[0]; hi = a[1]; } if (cmp(s, lo) < 0) return lo; if (cmp(s, hi) > 0) return hi; return s; });
}

function installEnumerable() {
  // Enumerable methods built on `each`. Collect via each, then delegate to Array.
  const E = EnumerableC;
  const collect = (s) => { const out = []; send(s, 'each', [], makeProc((args) => { out.push(args.length === 1 ? args[0] : args); })); return out; };
  for (const name of ['map', 'collect', 'select', 'filter', 'reject', 'find', 'detect',
    'reduce', 'inject', 'sum', 'min', 'max', 'min_by', 'max_by', 'sort', 'sort_by',
    'count', 'to_a', 'include?', 'first', 'group_by', 'partition', 'flat_map',
    'each_with_index', 'each_with_object', 'all?', 'any?', 'none?', 'tally',
    'take', 'drop', 'each_slice', 'each_cons', 'zip', 'find_index', 'uniq', 'filter_map',
    'reverse_each', 'take_while', 'drop_while', 'chunk_while', 'find_all', 'minmax',
    'each_entry', 'collect_concat', 'sort_by']) {
    def(E, name, (s, a, blk) => send(collect(s), name, a, blk));
  }
  def(E, 'entries', (s) => collect(s));
  def(E, 'to_a', (s) => collect(s));
}

// ---- Enumerator -----------------------------------------------------------
function mkLazy(genFn) { const e = new REnumerator(genFn); e._lazy = true; return e; }
// Enumerator::Lazy: chainable transformations evaluated on demand, so they work
// on infinite sequences. Each non-terminal op returns a new lazy enumerator.
function installLazy() {
  const L = LazyC;
  def(L, 'lazy', (s) => s);
  def(L, 'map', (s, a, blk) => mkLazy(function* () { for (const x of s) yield callBlock(blk, [x]); }));
  def(L, 'collect', L.methods.get('map'));
  def(L, 'flat_map', (s, a, blk) => mkLazy(function* () { for (const x of s) { const r = callBlock(blk, [x]); if (Array.isArray(r)) yield* r; else yield r; } }));
  def(L, 'select', (s, a, blk) => mkLazy(function* () { for (const x of s) if (truthy(callBlock(blk, [x]))) yield x; }));
  def(L, 'filter', L.methods.get('select'));
  def(L, 'find_all', L.methods.get('select'));
  def(L, 'reject', (s, a, blk) => mkLazy(function* () { for (const x of s) if (!truthy(callBlock(blk, [x]))) yield x; }));
  def(L, 'filter_map', (s, a, blk) => mkLazy(function* () { for (const x of s) { const r = callBlock(blk, [x]); if (truthy(r)) yield r; } }));
  def(L, 'take_while', (s, a, blk) => mkLazy(function* () { for (const x of s) { if (!truthy(callBlock(blk, [x]))) break; yield x; } }));
  def(L, 'drop_while', (s, a, blk) => mkLazy(function* () { let dropping = true; for (const x of s) { if (dropping && truthy(callBlock(blk, [x]))) continue; dropping = false; yield x; } }));
  def(L, 'take', (s, a) => { const n = numVal(a[0]); return mkLazy(function* () { let i = 0; if (n <= 0) return; for (const x of s) { yield x; if (++i >= n) break; } }); });
  def(L, 'drop', (s, a) => { const n = numVal(a[0]); return mkLazy(function* () { let i = 0; for (const x of s) { if (i++ < n) continue; yield x; } }); });
  def(L, 'with_index', (s, a, blk) => { const off = a[0] != null ? numVal(a[0]) : 0; if (blk) return mkLazy(function* () { let i = off; for (const x of s) yield callBlock(blk, [x, i++]); }); return mkLazy(function* () { let i = off; for (const x of s) yield [x, i++]; }); });
  def(L, 'each_with_index', (s, a, blk) => send(s, 'with_index', [0], blk));
  def(L, 'uniq', (s, a, blk) => mkLazy(function* () { const seen = new Set(); for (const x of s) { const k = hashKey(blk ? callBlock(blk, [x]) : x); if (!seen.has(k)) { seen.add(k); yield x; } } }));
  def(L, 'zip', (s, a) => mkLazy(function* () { const others = a.map((o) => toArray(o)); let i = 0; for (const x of s) { yield [x, ...others.map((o) => (i < o.length ? o[i] : null))]; i++; } }));
  // terminals
  def(L, 'first', (s, a) => { if (a[0] == null) { for (const x of s) return x; return null; } const n = numVal(a[0]); const out = []; if (n <= 0) return out; for (const x of s) { out.push(x); if (out.length >= n) break; } return out; });
  def(L, 'force', (s) => [...s]);
  def(L, 'to_a', (s) => [...s]);
  def(L, 'each', (s, a, blk) => { if (!blk) return s; try { for (const x of s) callBlock(blk, Array.isArray(x) ? x : [x]); } catch (e) { return brk(e); } return s; });
}

function installEnumerator() {
  const E = EnumeratorC;
  const pull = (s, n) => { const out = []; for (const x of s) { out.push(x); if (out.length >= n) break; } return out; };
  def(E, 'lazy', (s) => mkLazy(function* () { yield* s; }));
  def(E, 'each', (s, a, blk) => { if (!blk) return s; try { for (const x of s) callBlock(blk, Array.isArray(x) ? x : [x]); } catch (e) { return brk(e); } return s; });
  def(E, 'next', (s) => { if (!s._iter) s._iter = s.genFn(); const r = s._iter.next(); if (r.done) raiseError(StopIterationC, 'iteration reached an end'); return r.value; });
  def(E, 'peek', (s) => { if (!s._iter) s._iter = s.genFn(); if (s._peeked === undefined) { const r = s._iter.next(); if (r.done) raiseError(StopIterationC, 'iteration reached an end'); s._peeked = r.value; } return s._peeked; });
  def(E, 'rewind', (s) => { s._iter = null; s._peeked = undefined; return s; });
  def(E, 'first', (s, a) => (a[0] != null ? pull(s, numVal(a[0])) : (() => { for (const x of s) return x; return null; })()));
  def(E, 'take', (s, a) => pull(s, numVal(a[0])));
  def(E, 'to_a', (s) => [...s]);
  def(E, 'entries', (s) => [...s]);
  def(E, 'size', (s) => null);
  def(E, 'with_index', (s, a, blk) => { const off = a[0] != null ? numVal(a[0]) : 0; if (!blk) return mkEnum(function* () { let i = off; for (const x of s) yield [x, i++]; }); const out = []; let i = off; for (const x of s) out.push(callBlock(blk, [x, i++])); return out; });
  def(E, 'each_with_index', (s, a, blk) => send(s, 'with_index', [0], blk));
  def(E, 'with_object', (s, a, blk) => { const obj = a[0]; for (const x of s) callBlock(blk, [x, obj]); return obj; });
  def(E, 'each_with_object', E.methods.get('with_object'));
  // generic Enumerable methods materialize then delegate to Array
  for (const name of ['map', 'collect', 'select', 'filter', 'reject', 'find', 'detect',
    'reduce', 'inject', 'sum', 'min', 'max', 'min_by', 'max_by', 'sort', 'sort_by',
    'count', 'include?', 'group_by', 'partition', 'flat_map', 'all?', 'any?', 'none?',
    'tally', 'drop', 'each_slice', 'each_cons', 'zip', 'find_index', 'uniq', 'filter_map', 'reverse_each']) {
    def(E, name, (s, a, blk) => send([...s], name, a, blk));
  }
  def(E, 'inspect', (s) => new RString('#<Enumerator>'));
  def(E, 'to_s', (s) => new RString('#<Enumerator>'));
  // Enumerator.new { |y| y << 1; y << 2 } — eager: collect via a yielder.
  sdef(E, 'new', (cls, a, blk) => {
    const buf = [];
    const yielderClass = defConst('Enumerator::Yielder', ObjectC);
    if (!yielderClass.methods.has('<<')) {
      def(yielderClass, '<<', (self, args) => { self.ivars['@__buf'].push(args.length === 1 ? args[0] : args); return self; });
      def(yielderClass, 'yield', (self, args) => { self.ivars['@__buf'].push(args.length === 1 ? args[0] : args); return null; });
    }
    const yielder = new RObject(yielderClass);
    yielder.ivars['@__buf'] = buf;
    if (blk) callBlock(blk, [yielder]);
    return mkEnum(function* () { yield* buf; });
  });
}

// ---- Module / Class -------------------------------------------------------
function installModuleClass() {
  def(ModuleC, 'name', (s) => (s.name ? new RString(s.name) : null));
  def(ModuleC, 'to_s', (s) => new RString(s.name || '#<Class>'));
  def(ModuleC, 'inspect', (s) => new RString(s.name || '#<Class>'));
  def(ModuleC, '===', (s, a) => isA(a[0], s));
  def(ModuleC, '==', (s, a) => s === a[0]);
  def(ModuleC, 'instance_methods', (s) => { const out = new Set(); let c = s; while (c) { for (const k of c.methods.keys()) out.add(k); c = c.superclass; } return [...out].map((n) => new RSymbol(n)); });
  // v8ruby does not track method visibility — all methods are effectively public,
  // so the private/protected lists are empty and public mirrors instance_methods.
  def(ModuleC, 'public_instance_methods', ModuleC.methods.get('instance_methods'));
  def(ModuleC, 'private_instance_methods', () => []);
  def(ModuleC, 'protected_instance_methods', () => []);
  def(ModuleC, 'instance_method', (s, a) => makeProc((args) => send(args[0], a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]), args.slice(1))));
  def(ModuleC, 'method_defined?', (s, a) => !!findMethod(s, a[0] instanceof RSymbol ? a[0].name : jsstr(a[0])));
  def(ModuleC, 'const_get', (s, a) => {
    const n = a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]);
    // qualified name: Foo.const_get("Bar::Baz")
    if (n.includes('::')) { let base = s; for (const p of n.split('::')) { if (p === '') { base = ObjectC; continue; } base = constGetFrom(base, p); } return base; }
    return constGetFrom(s, n);
  });
  def(ModuleC, 'const_set', (s, a) => { const n = a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]); s.constants.set(n, a[1]); consts.set(n, a[1]); return a[1]; });
  def(ModuleC, 'const_defined?', (s, a) => {
    const n = a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]);
    let c = s instanceof RClass ? s : null;
    while (c) { if (c.constants.has(n) || (c.autoloads && c.autoloads.has(n))) return true; c = c.superclass; }
    return consts.has(n) || autoloads.has(n);
  });
  def(ModuleC, 'include', (s, a) => { for (const m of a) includeModule(s, m); return s; });
  def(ModuleC, 'prepend', (s, a) => { for (const m of a) includeModule(s, m); return s; });
  def(ModuleC, 'include?', (s, a) => s.includes.includes(a[0]));
  def(ModuleC, 'ancestors', (s) => { const out = []; let c = s; while (c) { out.push(c); for (let i = c.includes.length - 1; i >= 0; i--) if (!out.includes(c.includes[i])) out.push(c.includes[i]); c = c.superclass; } return out; });
  def(ModuleC, 'attr_accessor', (s, a) => defineAttr(s, 'attr_accessor', a.map((x) => x instanceof RSymbol ? x.name : jsstr(x))));
  def(ModuleC, 'attr_reader', (s, a) => defineAttr(s, 'attr_reader', a.map((x) => x instanceof RSymbol ? x.name : jsstr(x))));
  def(ModuleC, 'attr_writer', (s, a) => defineAttr(s, 'attr_writer', a.map((x) => x instanceof RSymbol ? x.name : jsstr(x))));
  def(ModuleC, 'define_method', (s, a, blk) => { const n = a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]); const body = blk || a[1]; s.methods.set(n, (self, args, b) => body.fn([...args], self)); return new RSymbol(n); });
  def(ModuleC, 'attr', ModuleC.methods.get('attr_reader'));
  def(ModuleC, 'class_eval', (s, a, blk) => { pushDefinee(s); try { return blk ? callBlock(blk, [s], s) : null; } finally { popDefinee(); } });
  def(ModuleC, 'module_eval', ModuleC.methods.get('class_eval'));
  def(ModuleC, 'class_exec', ModuleC.methods.get('class_eval'));
  def(ObjectC, 'instance_eval', (s, a, blk) => { pushDefinee(classOf(s)); try { return blk ? callBlock(blk, [s], s) : null; } finally { popDefinee(); } });
  def(ObjectC, 'instance_exec', (s, a, blk) => (blk ? callBlock(blk, a, s) : null));
  def(ModuleC, 'module_function', (s, a) => {
    if (a.length === 0) { s.__modfunc = true; return s; }
    for (const x of a) {
      const n = x instanceof RSymbol ? x.name : jsstr(x);
      const m = findMethod(s, n);
      if (m) s.smethods.set(n, m);
    }
    return a[a.length - 1];
  });
  def(ModuleC, 'remove_method', (s, a) => { for (const x of a) s.methods.delete(x instanceof RSymbol ? x.name : jsstr(x)); return s; });
  def(ModuleC, 'undef_method', (s, a) => { for (const x of a) s.methods.set(x instanceof RSymbol ? x.name : jsstr(x), (self) => { raiseError(NoMethodErrorC, `undefined method '${x instanceof RSymbol ? x.name : jsstr(x)}'`); }); return s; });
  def(ModuleC, '<', (s, a) => { if (s === a[0]) return false; let c = s; while (c) { if (c === a[0] || c.includes.includes(a[0])) return true; c = c.superclass; } return false; });
  def(ModuleC, '<=', (s, a) => s === a[0] || truthy(send(s, '<', [a[0]])));
  def(ModuleC, '>', (s, a) => a[0] instanceof RClass && truthy(send(a[0], '<', [s])));
  def(ModuleC, '>=', (s, a) => s === a[0] || truthy(send(s, '>', [a[0]])));
  def(ModuleC, 'autoload', (s, a) => { if (!s.autoloads) s.autoloads = new Map(); s.autoloads.set(a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]), a[1]); return null; });
  def(ModuleC, 'private_class_method', (s) => s);
  def(ModuleC, 'public_class_method', (s) => s);
  def(ModuleC, 'extended', () => null);
  def(ModuleC, 'instance_variable_get', (s, a) => (s.ivars[ivName(a[0])] ?? null));
  def(ModuleC, 'instance_variable_set', (s, a) => { s.ivars[ivName(a[0])] = a[1]; return a[1]; });
  def(ModuleC, 'private', (s, a) => (a.length ? a[0] : null));
  def(ModuleC, 'protected', (s, a) => (a.length ? a[0] : null));
  def(ModuleC, 'public', (s, a) => (a.length ? a[0] : null));
  def(ModuleC, 'private_constant', (s) => null);
  def(ModuleC, 'freeze', (s) => s);
  def(ModuleC, 'class_variable_get', (s, a) => cvarGet(s, a[0] instanceof RSymbol ? a[0].name : jsstr(a[0])));
  def(ModuleC, 'class_variable_set', (s, a) => cvarSet(s, a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]), a[1]));
  def(ModuleC, 'alias_method', (s, a) => { const nn = a[0] instanceof RSymbol ? a[0].name : jsstr(a[0]); const on = a[1] instanceof RSymbol ? a[1].name : jsstr(a[1]); const m = findMethod(s, on); if (m) s.methods.set(nn, m); return new RSymbol(nn); });

  def(ClassC, 'superclass', (s) => s.superclass);
  def(ClassC, 'new', (s, a, blk) => classNew(s, a, blk));
  def(ClassC, 'allocate', (s) => new RObject(s));
  sdef(ClassC, 'new', (cls, a, blk) => {
    const c = new RClass(null, a[0] || ObjectC);
    const sup = a[0] || ObjectC;
    const inh = findSingletonMethod(sup, 'inherited');
    if (inh) inh(sup, [c]);
    // Run the block with the new class as the current definee AND self, so
    // `def`/attr_reader/include inside it target the new (anonymous) class.
    if (blk) { pushDefinee(c); try { blk.fn([c], c); } finally { popDefinee(); } }
    return c;
  });
}

// ---- Exception ------------------------------------------------------------
function installException() {
  def(ExceptionC, 'initialize', (s, a) => { s.ivars['@message'] = a[0] != null ? (a[0] instanceof RString ? a[0] : new RString(toS(a[0]))) : new RString(s.rclass.name); return null; });
  def(ExceptionC, 'message', (s) => (s.ivars['@message'] != null ? (s.ivars['@message'] instanceof RString ? s.ivars['@message'] : new RString(toS(s.ivars['@message']))) : new RString(s.rclass.name)));
  def(ExceptionC, 'to_s', ExceptionC.methods.get('message'));
  def(ExceptionC, 'full_message', (s) => new RString(jsstr(send(s, 'message', [])) + ' (' + s.rclass.name + ')'));
  def(ExceptionC, 'inspect', (s) => new RString('#<' + s.rclass.name + ': ' + jsstr(send(s, 'message', [])) + '>'));
  def(ExceptionC, 'backtrace', () => []);
  def(ExceptionC, 'set_backtrace', () => []);
  def(ExceptionC, 'cause', () => null);
  def(ExceptionC, 'exception', (s, a) => { if (a.length === 0) return s; const o = new RObject(s.rclass); o.ivars['@message'] = a[0] instanceof RString ? a[0] : new RString(toS(a[0])); return o; });
  sdef(ExceptionC, 'exception', (cls, a) => { const o = new RObject(cls); const init = findMethod(cls, 'initialize'); if (init) init(o, a); return o; });
  def(KeyErrorC, 'key', (s) => (s.ivars['@key'] ?? null));
  def(StopIterationC, 'result', (s) => (s.ivars['@result'] ?? null));
}

// ---- Struct ---------------------------------------------------------------
function installStruct() {
  StructC.includes.push(EnumerableC);
  sdef(StructC, 'new', (cls, args, blk) => {
    // On a generated subclass, `new` allocates an instance (not a new struct).
    if (cls !== StructC) return classNew(cls, args, blk);
    let keywordInit = false;
    const members = [];
    for (const a of args) {
      if (a instanceof RHash) { keywordInit = truthy(a.get(R.sym('keyword_init'))); }
      else members.push(a instanceof RSymbol ? a.name : jsstr(a));
    }
    const klass = new RClass(null, StructC);
    klass.ivars['@__members'] = members;
    for (const m of members) {
      klass.methods.set(m, (self) => (self.ivars['@' + m] ?? null));
      klass.methods.set(m + '=', (self, aa) => { self.ivars['@' + m] = aa[0]; return aa[0]; });
    }
    klass.methods.set('initialize', (self, aa) => {
      if (keywordInit || (aa.length === 1 && aa[0] instanceof RHash && members.length !== 1)) {
        const h = aa[0];
        for (const m of members) self.ivars['@' + m] = (h && h.has(R.sym(m))) ? h.get(R.sym(m)) : null;
      } else {
        members.forEach((m, i) => { self.ivars['@' + m] = i < aa.length ? aa[i] : null; });
      }
      return null;
    });
    klass.methods.set('members', () => members.map((m) => R.sym(m)));
    klass.methods.set('to_a', (self) => members.map((m) => self.ivars['@' + m] ?? null));
    klass.methods.set('deconstruct', klass.methods.get('to_a'));
    klass.methods.set('values', klass.methods.get('to_a'));
    klass.methods.set('to_h', (self) => { const h = new RHash(); for (const m of members) h.set(R.sym(m), self.ivars['@' + m] ?? null); return h; });
    klass.methods.set('each', (self, aa, b) => { for (const m of members) callBlock(b, [self.ivars['@' + m] ?? null]); return self; });
    klass.methods.set('each_pair', (self, aa, b) => { for (const m of members) callBlock(b, [R.sym(m), self.ivars['@' + m] ?? null]); return self; });
    klass.methods.set('[]', (self, aa) => { const k = aa[0]; if (isInt(k)) { const m = members[k < 0 ? k + members.length : k]; return self.ivars['@' + m] ?? null; } const n = k instanceof RSymbol ? k.name : jsstr(k); return self.ivars['@' + n] ?? null; });
    klass.methods.set('[]=', (self, aa) => { const k = aa[0]; const m = isInt(k) ? members[k] : (k instanceof RSymbol ? k.name : jsstr(k)); self.ivars['@' + m] = aa[1]; return aa[1]; });
    klass.methods.set('==', (self, aa) => { const o = aa[0]; if (!(o instanceof RObject) || o.rclass !== self.rclass) return false; return members.every((m) => rbEqual(self.ivars['@' + m] ?? null, o.ivars['@' + m] ?? null)); });
    klass.methods.set('to_s', (self) => new RString(structInspect(self, members)));
    klass.methods.set('inspect', klass.methods.get('to_s'));
    klass.smethods.set('members', () => members.map((m) => R.sym(m)));
    if (blk) { pushDefinee(klass); try { callBlock(blk, [klass], klass); } finally { popDefinee(); } }
    return klass;
  });
}
function structInspect(self, members) {
  const name = self.rclass.name ? ' ' + self.rclass.name : '';
  const parts = members.map((m) => `${m}=${inspect(self.ivars['@' + m] ?? null)}`);
  return `#<struct${name} ${parts.join(', ')}>`;
}

// ---- Regexp / MatchData ---------------------------------------------------
function jsRe(pat, global) {
  if (pat instanceof RRegexp) { let f = pat.re.flags; if (global && !f.includes('g')) f += 'g'; return new RegExp(pat.re.source, f); }
  const s = jsstr(pat);
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), global ? 'g' : '');
}
function mkMatchData(m, str) {
  const md = new RObject(MatchDataC);
  md.ivars['@__m'] = m;
  md.ivars['@__str'] = str;
  return md;
}
function installRegexp() {
  const RG = RegexpC;
  sdef(RG, 'new', (cls, a) => new RRegexp(a[0] instanceof RRegexp ? a[0].source : jsstr(a[0]), a[1] != null ? jsstr(a[1]) : ''));
  sdef(RG, 'escape', (cls, a) => new RString(jsstr(a[0]).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')));
  sdef(RG, 'quote', RG.smethods.get('escape'));
  sdef(RG, 'union', (cls, a) => {
    // Regexp.union(a, b, ...) or Regexp.union([a, b, ...])
    let parts = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
    if (parts.length === 0) return new RRegexp('(?!)', '');
    const srcs = parts.map((p) => p instanceof RRegexp ? p.source : jsstr(p).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'));
    return new RRegexp(srcs.join('|'), '');
  });
  sdef(RG, 'last_match', (cls, a) => {
    const md = gvars['$~'] ?? null;
    if (md == null) return null;
    if (a.length === 0) return md;
    return send(md, '[]', [a[0]]);
  });
  def(RG, 'match?', (s, a) => { const str = jsstr(a[0]); return s.re.test(str); });
  def(RG, 'match', (s, a) => { const str = jsstr(a[0]); const m = str.match(new RegExp(s.re.source, s.re.flags.replace('g', ''))); gvars['$~'] = m ? mkMatchData(m, str) : null; return m ? mkMatchData(m, str) : null; });
  def(RG, '=~', (s, a) => { if (!(a[0] instanceof RString)) return null; const m = a[0].value.match(new RegExp(s.re.source, s.re.flags.replace('g', ''))); return m ? m.index : null; });
  def(RG, '===', (s, a) => { if (!(a[0] instanceof RString || a[0] instanceof RSymbol)) { return false; } const str = toS(a[0]); const m = str.match(new RegExp(s.re.source, s.re.flags.replace('g', ''))); gvars['$~'] = m ? mkMatchData(m, str) : null; return !!m; });
  def(RG, 'source', (s) => new RString(s.source));
  def(RG, 'to_s', (s) => new RString(regexpToS(s)));
  def(RG, 'inspect', (s) => new RString('/' + s.source + '/' + s.rflags.replace(/[^imx]/g, '')));
  def(RG, '==', (s, a) => a[0] instanceof RRegexp && s.source === a[0].source && s.rflags === a[0].rflags);
  def(RG, 'names', (s) => { const names = []; const re = /\(\?<([a-zA-Z_]\w*)>/g; let m; while ((m = re.exec(s.source))) names.push(new RString(m[1])); return names; });

  const M = MatchDataC;
  def(M, '[]', (s, a) => { const m = s.ivars['@__m']; const k = a[0]; if (isInt(k)) return m[k] != null ? new RString(m[k]) : null; const n = k instanceof RSymbol ? k.name : jsstr(k); return m.groups && m.groups[n] != null ? new RString(m.groups[n]) : null; });
  def(M, 'to_a', (s) => Array.from(s.ivars['@__m']).map((x) => (x != null ? new RString(x) : null)));
  def(M, 'captures', (s) => Array.from(s.ivars['@__m']).slice(1).map((x) => (x != null ? new RString(x) : null)));
  def(M, 'named_captures', (s) => { const h = new RHash(); const g = s.ivars['@__m'].groups || {}; for (const k of Object.keys(g)) h.set(new RString(k), g[k] != null ? new RString(g[k]) : null); return h; });
  def(M, 'pre_match', (s) => new RString(s.ivars['@__str'].slice(0, s.ivars['@__m'].index)));
  def(M, 'post_match', (s) => new RString(s.ivars['@__str'].slice(s.ivars['@__m'].index + s.ivars['@__m'][0].length)));
  def(M, 'begin', (s) => s.ivars['@__m'].index);
  def(M, 'to_s', (s) => new RString(s.ivars['@__m'][0]));
  def(M, 'size', (s) => s.ivars['@__m'].length);
}

// ---- Node-backed core: File, Dir, IO, Time, Process, Thread, Data ---------
function installNodeCore() {
  const symstr = (x) => (x instanceof RSymbol ? x.name : jsstr(x));

  // ---- IO / STDOUT / STDERR ----
  const IOC = defClass('IO', ObjectC);
  const mkIO = (stream, fd) => { const o = new RObject(IOC); o.ivars['@__stream'] = stream; o.ivars['@__fd'] = fd; return o; };
  const streamOf = (io) => io.ivars['@__stream'];
  def(IOC, 'write', (s, a) => { let n = 0; for (const x of a) { const t = toS(x); n += t.length; streamOf(s).write(t); } return n; });
  def(IOC, '<<', (s, a) => { streamOf(s).write(toS(a[0])); return s; });
  def(IOC, 'print', (s, a) => { for (const x of a) streamOf(s).write(toS(x)); return null; });
  def(IOC, 'puts', (s, a) => { putsTo(streamOf(s), a); return null; });
  def(IOC, 'printf', (s, a) => { streamOf(s).write(sprintf(jsstr(a[0]), a.slice(1))); return null; });
  def(IOC, 'flush', (s) => s);
  def(IOC, 'sync', () => true);
  def(IOC, 'sync=', (s, a) => a[0]);
  def(IOC, 'fileno', (s) => s.ivars['@__fd']);
  def(IOC, 'tty?', (s) => !!streamOf(s).isTTY);
  def(IOC, 'isatty', IOC.methods.get('tty?'));
  def(IOC, 'close', () => null);
  def(IOC, 'gets', () => null);
  const stdout = mkIO(process.stdout, 1);
  const stderr = mkIO(process.stderr, 2);
  consts.set('STDOUT', stdout);
  consts.set('STDERR', stderr);
  gvars['$stdout'] = stdout;
  gvars['$stderr'] = stderr;
  gvars['$PROGRAM_NAME'] = new RString('v8ruby');

  // ---- File (class methods only; instance form via File.open is limited) ----
  const FileC = defClass('File', IOC);
  FileC.constants.set('SEPARATOR', new RString('/'));
  FileC.constants.set('ALT_SEPARATOR', null);
  FileC.constants.set('PATH_SEPARATOR', new RString(':'));
  const P = (a) => jsstr(a);
  sdef(FileC, 'join', (c, a) => new RString(a.map((x) => (Array.isArray(x) ? x.map(jsstr).join('/') : jsstr(x))).join('/')));
  sdef(FileC, 'dirname', (c, a) => new RString(nodePath.dirname(P(a[0]))));
  sdef(FileC, 'basename', (c, a) => {
    let b = nodePath.basename(P(a[0]));
    if (a[1]) { const suf = jsstr(a[1]); if (suf === '.*') b = b.replace(/\.[^.]+$/, ''); else if (b.endsWith(suf)) b = b.slice(0, -suf.length); }
    return new RString(b);
  });
  sdef(FileC, 'extname', (c, a) => new RString(nodePath.extname(P(a[0]))));
  sdef(FileC, 'expand_path', (c, a) => {
    let p = P(a[0]);
    if (p === '~' || p.startsWith('~/')) p = nodePath.join(homedir(), p.slice(1));
    const base = a[1] ? P(a[1]) : process.cwd();
    return new RString(nodePath.resolve(base, p));
  });
  sdef(FileC, 'absolute_path', FileC.smethods.get('expand_path'));
  sdef(FileC, 'absolute_path?', (c, a) => nodePath.isAbsolute(P(a[0])));
  sdef(FileC, 'exist?', (c, a) => fs.existsSync(P(a[0])));
  sdef(FileC, 'exists?', FileC.smethods.get('exist?'));
  sdef(FileC, 'file?', (c, a) => { try { return fs.statSync(P(a[0])).isFile(); } catch { return false; } });
  sdef(FileC, 'directory?', (c, a) => { try { return fs.statSync(P(a[0])).isDirectory(); } catch { return false; } });
  sdef(FileC, 'symlink?', (c, a) => { try { return fs.lstatSync(P(a[0])).isSymbolicLink(); } catch { return false; } });
  sdef(FileC, 'readable?', (c, a) => { try { fs.accessSync(P(a[0]), fs.constants.R_OK); return true; } catch { return false; } });
  sdef(FileC, 'writable?', (c, a) => { try { fs.accessSync(P(a[0]), fs.constants.W_OK); return true; } catch { return false; } });
  sdef(FileC, 'executable?', (c, a) => { try { fs.accessSync(P(a[0]), fs.constants.X_OK); return true; } catch { return false; } });
  sdef(FileC, 'size', (c, a) => { try { return fs.statSync(P(a[0])).size; } catch { raiseError(consts.get('Errno') ? StandardErrorC : StandardErrorC, `No such file -- ${P(a[0])}`); } });
  sdef(FileC, 'zero?', (c, a) => { try { return fs.statSync(P(a[0])).size === 0; } catch { return false; } });
  sdef(FileC, 'read', (c, a) => { try { return new RString(fs.readFileSync(P(a[0]), 'utf8')); } catch (e) { raiseError(LoadErrorC.superclass === ScriptErrorC ? StandardErrorC : StandardErrorC, `No such file or directory @ rb_sysopen - ${P(a[0])}`); } });
  sdef(FileC, 'binread', FileC.smethods.get('read'));
  sdef(FileC, 'write', (c, a) => { const t = toS(a[1]); fs.writeFileSync(P(a[0]), t); return t.length; });
  sdef(FileC, 'readlines', (c, a) => fs.readFileSync(P(a[0]), 'utf8').split(/(?<=\n)/).filter((l) => l.length).map((l) => new RString(l)));
  sdef(FileC, 'foreach', (c, a, blk) => { for (const l of fs.readFileSync(P(a[0]), 'utf8').split(/(?<=\n)/)) if (l.length) callBlock(blk, [new RString(l)]); return null; });
  sdef(FileC, 'delete', (c, a) => { let n = 0; for (const x of a) { fs.unlinkSync(P(x)); n++; } return n; });
  sdef(FileC, 'unlink', FileC.smethods.get('delete'));
  sdef(FileC, 'rename', (c, a) => { fs.renameSync(P(a[0]), P(a[1])); return 0; });
  sdef(FileC, 'realpath', (c, a) => new RString(fs.realpathSync(P(a[0]))));
  sdef(FileC, 'split', (c, a) => [new RString(nodePath.dirname(P(a[0]))), new RString(nodePath.basename(P(a[0])))]);
  sdef(FileC, 'mtime', (c, a) => mkTime(fs.statSync(P(a[0])).mtimeMs));
  sdef(FileC, 'open', (c, a, blk) => {
    const path = P(a[0]);
    const mode = a[1] ? jsstr(a[1]) : 'r';
    const fh = new RObject(FileHandleC);
    fh.ivars['@__path'] = new RString(path);
    fh.ivars['@__mode'] = new RString(mode);
    if (mode.startsWith('w')) fs.writeFileSync(path, '');
    if (blk) { try { return callBlock(blk, [fh]); } finally { /* no-op close */ } }
    return fh;
  });
  const FileHandleC = defClass('File::Handle', ObjectC);
  const fhPath = (s) => jsstr(s.ivars['@__path']);
  def(FileHandleC, 'read', (s) => new RString(fs.readFileSync(fhPath(s), 'utf8')));
  def(FileHandleC, 'write', (s, a) => { let n = 0; for (const x of a) { const t = toS(x); fs.appendFileSync(fhPath(s), t); n += t.length; } return n; });
  def(FileHandleC, '<<', (s, a) => { fs.appendFileSync(fhPath(s), toS(a[0])); return s; });
  def(FileHandleC, 'puts', (s, a) => { const out = []; const w = { write: (t) => out.push(t) }; putsTo(w, a); fs.appendFileSync(fhPath(s), out.join('')); return null; });
  def(FileHandleC, 'print', (s, a) => { for (const x of a) fs.appendFileSync(fhPath(s), toS(x)); return null; });
  def(FileHandleC, 'each_line', (s, a, blk) => { for (const l of fs.readFileSync(fhPath(s), 'utf8').split(/(?<=\n)/)) if (l.length) callBlock(blk, [new RString(l)]); return s; });
  def(FileHandleC, 'readlines', (s) => fs.readFileSync(fhPath(s), 'utf8').split(/(?<=\n)/).filter((l) => l.length).map((l) => new RString(l)));
  def(FileHandleC, 'close', () => null);
  def(FileHandleC, 'path', (s) => s.ivars['@__path']);
  def(FileHandleC, 'flush', (s) => s);

  // ---- Dir ----
  const DirC = defClass('Dir', ObjectC);
  sdef(DirC, 'pwd', () => new RString(process.cwd()));
  sdef(DirC, 'getwd', DirC.smethods.get('pwd'));
  sdef(DirC, 'home', () => new RString(homedir()));
  sdef(DirC, 'exist?', (c, a) => { try { return fs.statSync(P(a[0])).isDirectory(); } catch { return false; } });
  sdef(DirC, 'entries', (c, a) => ['.', '..'].concat(fs.readdirSync(P(a[0]))).map((x) => new RString(x)));
  sdef(DirC, 'children', (c, a) => fs.readdirSync(P(a[0])).map((x) => new RString(x)));
  sdef(DirC, 'mkdir', (c, a) => { fs.mkdirSync(P(a[0])); return 0; });
  sdef(DirC, 'delete', (c, a) => { fs.rmdirSync(P(a[0])); return 0; });
  sdef(DirC, 'rmdir', DirC.smethods.get('delete'));
  sdef(DirC, 'unlink', DirC.smethods.get('delete'));
  sdef(DirC, 'empty?', (c, a) => { try { return fs.readdirSync(P(a[0])).length === 0; } catch { return false; } });
  sdef(DirC, 'chdir', (c, a, blk) => { const prev = process.cwd(); process.chdir(P(a[0])); if (blk) { try { return callBlock(blk, [new RString(process.cwd())]); } finally { process.chdir(prev); } } return 0; });
  sdef(DirC, 'glob', (c, a, blk) => {
    const pats = Array.isArray(a[0]) ? a[0].map(jsstr) : [jsstr(a[0])];
    const base = a[1] instanceof RHash && a[1].get(R.sym('base')) ? jsstr(a[1].get(R.sym('base'))) : process.cwd();
    const out = [];
    for (const pat of pats) globWalk(pat, base, out);
    const res = out.map((x) => new RString(x));
    if (blk) { for (const x of res) callBlock(blk, [x]); return null; }
    return res;
  });
  sdef(DirC, '[]', DirC.smethods.get('glob'));

  // ---- Time ----
  const TimeC = defClass('Time', ObjectC);
  TimeC.includes.push(ComparableC);
  function mkTime(ms, utc = false) { const o = new RObject(TimeC); o.ivars['@__ms'] = ms; o.ivars['@__utc'] = utc; return o; }
  const tms = (s) => s.ivars['@__ms'];
  const tdate = (s) => new Date(tms(s));
  const isUTC = (s) => !!s.ivars['@__utc'];
  sdef(TimeC, 'now', () => mkTime(Date.now()));
  sdef(TimeC, 'at', (c, a) => mkTime(numVal(a[0]) * 1000));
  def(TimeC, 'to_i', (s) => Math.floor(tms(s) / 1000));
  def(TimeC, 'to_f', (s) => mkfloat(tms(s) / 1000));
  def(TimeC, 'usec', (s) => Math.floor((tms(s) % 1000) * 1000));
  def(TimeC, '+', (s, a) => mkTime(tms(s) + numVal(a[0]) * 1000, isUTC(s)));
  def(TimeC, '-', (s, a) => {
    if (a[0] instanceof RObject && a[0].rclass === TimeC) return mkfloat((tms(s) - tms(a[0])) / 1000);
    return mkTime(tms(s) - numVal(a[0]) * 1000, isUTC(s));
  });
  def(TimeC, '<=>', (s, a) => { const o = tms(a[0]); return tms(s) < o ? -1 : tms(s) > o ? 1 : 0; });
  def(TimeC, '==', (s, a) => a[0] instanceof RObject && a[0].rclass === TimeC && tms(s) === tms(a[0]));
  const dget = (s, f) => { const d = tdate(s); return isUTC(s) ? d['getUTC' + f]() : d['get' + f](); };
  def(TimeC, 'year', (s) => dget(s, 'FullYear'));
  def(TimeC, 'month', (s) => dget(s, 'Month') + 1);
  def(TimeC, 'mon', TimeC.methods.get('month'));
  def(TimeC, 'day', (s) => dget(s, 'Date'));
  def(TimeC, 'mday', TimeC.methods.get('day'));
  def(TimeC, 'hour', (s) => dget(s, 'Hours'));
  def(TimeC, 'min', (s) => dget(s, 'Minutes'));
  def(TimeC, 'sec', (s) => dget(s, 'Seconds'));
  def(TimeC, 'wday', (s) => dget(s, 'Day'));
  def(TimeC, 'yday', (s) => { const d = tdate(s); const start = new Date(d.getFullYear(), 0, 0); return Math.floor((d - start) / 86400000); });
  def(TimeC, 'monday?', (s) => dget(s, 'Day') === 1);
  def(TimeC, 'sunday?', (s) => dget(s, 'Day') === 0);
  def(TimeC, 'utc', (s) => mkTime(tms(s), true));
  def(TimeC, 'getutc', TimeC.methods.get('utc'));
  def(TimeC, 'gmtime', TimeC.methods.get('utc'));
  def(TimeC, 'utc?', (s) => isUTC(s));
  def(TimeC, 'localtime', (s) => mkTime(tms(s), false));
  def(TimeC, 'zone', (s) => new RString(isUTC(s) ? 'UTC' : 'Local'));
  def(TimeC, 'strftime', (s, a) => new RString(strftime(s, jsstr(a[0]))));
  def(TimeC, 'iso8601', (s) => new RString(strftime(s, '%Y-%m-%dT%H:%M:%S%z')));
  def(TimeC, 'to_s', (s) => new RString(strftime(s, '%Y-%m-%d %H:%M:%S %z')));
  def(TimeC, 'inspect', TimeC.methods.get('to_s'));
  function strftime(t, fmt) {
    const pad = (n, w = 2, c = '0') => String(n).padStart(w, c);
    const d = tdate(t);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const g = (f) => dget(t, f);
    const offMin = isUTC(t) ? 0 : -d.getTimezoneOffset();
    const tz = (offMin < 0 ? '-' : '+') + pad(Math.floor(Math.abs(offMin) / 60)) + pad(Math.abs(offMin) % 60);
    return fmt.replace(/%(-?)([A-Za-z%])/g, (m, dash, c) => {
      switch (c) {
        case 'Y': return String(g('FullYear'));
        case 'y': return pad(g('FullYear') % 100);
        case 'm': return dash ? String(g('Month') + 1) : pad(g('Month') + 1);
        case 'd': return dash ? String(g('Date')) : pad(g('Date'));
        case 'e': return pad(g('Date'), 2, ' ');
        case 'H': return dash ? String(g('Hours')) : pad(g('Hours'));
        case 'I': return pad(((g('Hours') + 11) % 12) + 1);
        case 'M': return dash ? String(g('Minutes')) : pad(g('Minutes'));
        case 'S': return dash ? String(g('Seconds')) : pad(g('Seconds'));
        case 'L': return pad(tms(t) % 1000, 3);
        case 'j': return pad(numVal(send(t, 'yday', [])), 3);
        case 'A': return days[g('Day')];
        case 'a': return days[g('Day')].slice(0, 3);
        case 'B': return months[g('Month')];
        case 'b': return months[g('Month')].slice(0, 3);
        case 'p': return g('Hours') < 12 ? 'AM' : 'PM';
        case 'z': return tz;
        case 'Z': return isUTC(t) ? 'UTC' : '';
        case 's': return String(Math.floor(tms(t) / 1000));
        case 'F': return `${g('FullYear')}-${pad(g('Month') + 1)}-${pad(g('Date'))}`;
        case 'T': return `${pad(g('Hours'))}:${pad(g('Minutes'))}:${pad(g('Seconds'))}`;
        case '%': return '%';
        default: return m;
      }
    });
  }

  // ---- Process / Signal / Thread / Mutex ----
  const ProcessM = defClass('Process', null, true);
  ProcessM.constants.set('CLOCK_MONOTONIC', 1);
  ProcessM.constants.set('CLOCK_REALTIME', 2);
  sdef(ProcessM, 'pid', () => process.pid);
  sdef(ProcessM, 'clock_gettime', () => mkfloat(Number(process.hrtime.bigint()) / 1e9));
  sdef(ProcessM, 'exit', (c, a) => send(mainObject, 'exit', a));
  const SignalM = defClass('Signal', null, true);
  sdef(SignalM, 'trap', () => null);
  def(ObjectC, 'trap', () => null);

  const MutexC = defClass('Mutex', ObjectC);
  def(MutexC, 'synchronize', (s, a, blk) => callBlock(blk, []));
  def(MutexC, 'lock', (s) => s);
  def(MutexC, 'unlock', (s) => s);
  def(MutexC, 'try_lock', () => true);
  def(MutexC, 'locked?', () => false);
  def(MutexC, 'owned?', () => false);

  const ThreadC = defClass('Thread', ObjectC);
  ThreadC.constants.set('Mutex', MutexC);
  const threadMain = new RObject(ThreadC);
  threadMain.ivars['@__locals'] = new RHash();
  sdef(ThreadC, 'current', () => threadMain);
  sdef(ThreadC, 'main', () => threadMain);
  sdef(ThreadC, 'new', (c, a, blk) => {
    // single-threaded: run the block immediately and remember its value
    const t = new RObject(ThreadC);
    t.ivars['@__locals'] = new RHash();
    t.ivars['@__value'] = blk ? callBlock(blk, a) : null;
    return t;
  });
  sdef(ThreadC, 'start', ThreadC.smethods.get('new'));
  def(ThreadC, '[]', (s, a) => { const h = s.ivars['@__locals']; const v = h.get(a[0]); return v === undefined ? null : v; });
  def(ThreadC, '[]=', (s, a) => { s.ivars['@__locals'].set(a[0], a[1]); return a[1]; });
  def(ThreadC, 'key?', (s, a) => s.ivars['@__locals'].has(a[0]));
  def(ThreadC, 'join', (s) => s);
  def(ThreadC, 'value', (s) => (s.ivars['@__value'] ?? null));
  def(ThreadC, 'alive?', () => false);
  def(ThreadC, 'kill', (s) => s);

  // ---- Data.define ----
  const DataC = defClass('Data', ObjectC);
  sdef(DataC, 'define', (cls, args, blk) => {
    const members = args.map((x) => symstr(x));
    const klass = new RClass(null, DataC);
    klass.ivars['@__members'] = members;
    for (const m of members) klass.methods.set(m, (self) => (self.ivars['@' + m] ?? null));
    klass.smethods.set('members', () => members.map((m) => R.sym(m)));
    klass.smethods.set('new', (kc, aa, b) => {
      if (kc !== klass && kc instanceof RClass) { /* subclass: same behavior */ }
      const obj = new RObject(kc instanceof RClass ? kc : klass);
      if (aa.length === 1 && aa[0] instanceof RHash && members.length !== 1) {
        for (const m of members) obj.ivars['@' + m] = aa[0].has(R.sym(m)) ? aa[0].get(R.sym(m)) : null;
      } else if (aa.length && aa[aa.length - 1] instanceof RHash && aa.length - 1 < members.length) {
        const kw = aa[aa.length - 1];
        aa.slice(0, -1).forEach((v, i) => { obj.ivars['@' + members[i]] = v; });
        for (const m of members) if (kw.has(R.sym(m))) obj.ivars['@' + m] = kw.get(R.sym(m));
      } else {
        if (aa.length > members.length) raiseError(ArgumentErrorC, 'wrong number of arguments');
        members.forEach((m, i) => { obj.ivars['@' + m] = i < aa.length ? aa[i] : null; });
      }
      return obj;
    });
    klass.smethods.set('[]', klass.smethods.get('new'));
    klass.methods.set('members', () => members.map((m) => R.sym(m)));
    klass.methods.set('to_h', (self) => { const h = new RHash(); for (const m of members) h.set(R.sym(m), self.ivars['@' + m] ?? null); return h; });
    klass.methods.set('deconstruct', (self) => members.map((m) => self.ivars['@' + m] ?? null));
    klass.methods.set('with', (self, aa) => { const o = new RObject(self.rclass); Object.assign(o.ivars, self.ivars); if (aa[0] instanceof RHash) for (const [k, v] of aa[0].entries()) o.ivars['@' + symstr(k)] = v; return o; });
    klass.methods.set('==', (self, aa) => { const o = aa[0]; if (!(o instanceof RObject) || o.rclass !== self.rclass) return false; return members.every((m) => rbEqual(self.ivars['@' + m] ?? null, o.ivars['@' + m] ?? null)); });
    klass.methods.set('inspect', (self) => { const nm = self.rclass.name ? ' ' + self.rclass.name : ''; return new RString(`#<data${nm} ${members.map((m) => `${m}=${inspect(self.ivars['@' + m] ?? null)}`).join(', ')}>`); });
    klass.methods.set('to_s', klass.methods.get('inspect'));
    if (blk) { pushDefinee(klass); try { callBlock(blk, [klass], klass); } finally { popDefinee(); } }
    return klass;
  });

  // ---- Kernel: at_exit, autoload ----
  def(ObjectC, 'at_exit', (self, a, blk) => { if (blk) R.__atexit.push(blk); return blk; });
  def(ObjectC, 'autoload', (self, a) => { autoloads.set(symstr(a[0]), a[1]); return null; });
  def(ObjectC, 'exit!', ObjectC.methods.get('exit'));
  def(ObjectC, 'caller_locations', () => []);
  def(ObjectC, 'binding', () => null);

  // ---- RUBY_* constants ----
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
  consts.set('RUBY_VERSION', new RString('3.4.0'));
  consts.set('RUBY_ENGINE', new RString('v8ruby'));
  consts.set('RUBY_ENGINE_VERSION', new RString('0.1.0'));
  consts.set('RUBY_PLATFORM', new RString(`${arch}-linux`));
  consts.set('RUBY_RELEASE_DATE', new RString('2026-06-10'));
  consts.set('RUBY_DESCRIPTION', new RString(`v8ruby 0.1.0 (Ruby on V8 ${process.versions.v8})`));
  consts.set('RUBY_COPYRIGHT', new RString('v8ruby'));
  consts.set('RUBY_PATCHLEVEL', 0);
  consts.set('ARGV', []);
  const envHash = new RHash();
  for (const [k, v] of Object.entries(process.env)) envHash.set(new RString(k), new RString(v));
  consts.set('ENV', envHash);
}

// Generic puts onto any sink with .write (used by IO#puts and File handles).
function putsTo(sink, args) {
  if (args.length === 0) { sink.write('\n'); return; }
  for (const a of args) {
    if (Array.isArray(a)) { if (a.length === 0) sink.write('\n'); else putsTo(sink, a); }
    else { const s = toS(a); sink.write(s.endsWith('\n') ? s : s + '\n'); }
  }
}

// Minimal glob: supports **, *, ?, {a,b} and [] classes.
function globWalk(pattern, base, out) {
  const abs = nodePath.isAbsolute(pattern);
  const root = abs ? '/' : base;
  const pat = abs ? pattern.slice(1) : pattern;
  const segments = pat.split('/');
  const results = [];
  // Match the pattern one path-segment at a time so explicitly-named hidden
  // directories (e.g. `.rbenv`) are traversed, while wildcard segments still
  // skip dotfiles like MRI's Dir.glob does.
  const walk = (dir, rel, segIdx, depth) => {
    if (depth > 64) return;
    if (segIdx >= segments.length) { results.push(abs ? '/' + rel : rel); return; }
    const seg = segments[segIdx];
    const last = segIdx === segments.length - 1;
    // `**` matches zero or more directories
    if (seg === '**') {
      // zero directories: continue matching the rest here
      walk(dir, rel, segIdx + 1, depth);
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory()) walk(nodePath.join(dir, e.name), rel ? rel + '/' + e.name : e.name, segIdx, depth + 1);
      }
      return;
    }
    const re = globToRegex(seg);
    const literalHidden = seg.startsWith('.');
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && !literalHidden) continue;
      if (!re.test(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (last) results.push(abs ? '/' + r : r);
      else if (e.isDirectory()) walk(nodePath.join(dir, e.name), r, segIdx + 1, depth + 1);
    }
  };
  walk(root, '', 0, 0);
  results.sort();
  out.push(...results);
}
function globToRegex(pat) {
  let out = '';
  let i = 0;
  while (i < pat.length) {
    const c = pat[i];
    if (c === '*' && pat[i + 1] === '*') {
      // `**/` matches zero or more directories
      if (pat[i + 2] === '/') { out += '(?:.*/)?'; i += 3; } else { out += '.*'; i += 2; }
    } else if (c === '*') { out += '[^/]*'; i++; }
    else if (c === '?') { out += '[^/]'; i++; }
    else if (c === '{') {
      const end = pat.indexOf('}', i);
      const alts = pat.slice(i + 1, end).split(',');
      out += '(?:' + alts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end + 1;
    } else if (c === '[') {
      const end = pat.indexOf(']', i);
      out += pat.slice(i, end + 1);
      i = end + 1;
    } else { out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; }
  }
  return new RegExp('^' + out + '$');
}

// ---- Math -----------------------------------------------------------------
function installMath() {
  MathM.constants.set('PI', mkfloat(Math.PI));
  MathM.constants.set('E', mkfloat(Math.E));
  consts.set('Math', MathM);
  const m1 = (name, fn) => sdef(MathM, name, (s, a) => mkfloat(fn(numVal(a[0]))));
  m1('sqrt', Math.sqrt); m1('cbrt', Math.cbrt); m1('sin', Math.sin); m1('cos', Math.cos);
  m1('tan', Math.tan); m1('asin', Math.asin); m1('acos', Math.acos); m1('atan', Math.atan);
  m1('sinh', Math.sinh); m1('cosh', Math.cosh); m1('tanh', Math.tanh);
  m1('exp', Math.exp); m1('log2', Math.log2); m1('log10', Math.log10);
  sdef(MathM, 'log', (s, a) => mkfloat(a[1] != null ? Math.log(numVal(a[0])) / Math.log(numVal(a[1])) : Math.log(numVal(a[0]))));
  sdef(MathM, 'pow', (s, a) => mkfloat(Math.pow(numVal(a[0]), numVal(a[1]))));
  sdef(MathM, 'hypot', (s, a) => mkfloat(Math.hypot(numVal(a[0]), numVal(a[1]))));
  sdef(MathM, 'atan2', (s, a) => mkfloat(Math.atan2(numVal(a[0]), numVal(a[1]))));
  sdef(MathM, 'floor', (s, a) => Math.floor(numVal(a[0])));
  // Make Math constants reachable as Math::PI
  MathM.ivars = MathM.ivars || {};
}

// Float / Integer class constants
FloatC.constants.set('INFINITY', mkfloat(Infinity));
FloatC.constants.set('NAN', mkfloat(NaN));
IntegerC.constants.set('MAX', Number.MAX_SAFE_INTEGER);

export default R;
export { classOf, send, RubyError, ReturnError, BreakError, NextError };
