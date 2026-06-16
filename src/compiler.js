// Compiler: AST -> JavaScript source executed on V8.
//
// Two passes:
//   1. analyze(): walk the AST building a scope tree, recording which local
//      variables each scope OWNS. Ruby has no variable declarations; a name is
//      a local from its first assignment in a scope. Blocks/lambdas capture
//      enclosing locals; def/class/module/top are hard boundaries.
//   2. gen(): emit JS. Each Ruby expression becomes a JS expression; method and
//      block bodies become JS functions returning their last value. All method
//      dispatch routes through R.send so Ruby semantics (truthiness, integer
//      division, operator overloading, method_missing) are preserved.

import { parse } from './parser.js';

// A lexical scope. kind: 'top' | 'def' | 'class' | 'block' | 'lambda'.
class Scope {
  constructor(kind, parent, params = []) {
    this.kind = kind;
    this.parent = parent;
    this.vars = new Set();
    this.params = new Set(params);
    for (const p of params) this.vars.add(p);
  }
  capturing() { return this.kind === 'block' || this.kind === 'lambda'; }
}

// Find the scope that owns `name`, searching up through capturing scopes and
// the nearest hard scope. Returns null if not found (=> new local).
function resolveScope(scope, name) {
  let s = scope;
  while (s) {
    if (s.vars.has(name)) return s;
    if (!s.capturing()) return null; // hard boundary: stop after checking it
    s = s.parent;
  }
  return null;
}

function isVisible(scope, name) { return resolveScope(scope, name) !== null; }

function declareLocal(scope, name) {
  if (!resolveScope(scope, name)) scope.vars.add(name);
}

// ---- Pass 1: scope analysis ----------------------------------------------
function analyze(node, scope) {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) analyze(n, scope); return; }
  if (typeof node !== 'object') return;
  if (!node.type) {
    // untyped container (hash pairs, string/regex parts…): walk its values
    for (const k of Object.keys(node)) {
      if (k.startsWith('__')) continue;
      analyze(node[k], scope);
    }
    return;
  }

  switch (node.type) {
    case 'Program': {
      const s = new Scope('top', null);
      node.__scope = s;
      analyze(node.body, s);
      return;
    }
    case 'Assign': {
      if (node.target.type === 'Ident') declareLocal(scope, node.target.name);
      else analyze(node.target, scope);
      analyze(node.value, scope);
      return;
    }
    case 'OpAssign': {
      if (node.target.type === 'Ident') declareLocal(scope, node.target.name);
      else analyze(node.target, scope);
      analyze(node.value, scope);
      return;
    }
    case 'MultiAssign': {
      for (const t of node.targets) declareTarget(scope, t);
      analyze(node.values, scope);
      return;
    }
    case 'For': {
      for (const v of node.vars) declareLocal(scope, v);
      analyze(node.iter, scope);
      analyze(node.body, scope);
      return;
    }
    case 'Def': {
      if (node.singleton) analyze(node.singleton, scope);
      const params = collectParamNames(node.params);
      const s = new Scope('def', scope, params);
      node.__scope = s;
      analyzeParams(node.params, s);
      analyze(node.body, s);
      return;
    }
    case 'Class': {
      analyze(node.superclass, scope);
      const s = new Scope('class', scope);
      node.__scope = s;
      analyze(node.body, s);
      return;
    }
    case 'Module': {
      const s = new Scope('class', scope);
      node.__scope = s;
      analyze(node.body, s);
      return;
    }
    case 'SingletonClass': {
      analyze(node.obj, scope);
      const s = new Scope('class', scope);
      node.__scope = s;
      analyze(node.body, s);
      return;
    }
    case 'Lambda': {
      const params = collectParamNames(node.params);
      const s = new Scope('lambda', scope, params);
      node.__scope = s;
      analyzeParams(node.params, s);
      analyze(node.body, s);
      return;
    }
    case 'Call': {
      analyze(node.receiver, scope);
      analyze(node.args, scope);
      if (node.blockArg) analyze(node.blockArg, scope);
      if (node.block) analyzeBlock(node.block, scope);
      return;
    }
    case 'Super': {
      if (node.args) analyze(node.args, scope);
      if (node.blockArg) analyze(node.blockArg, scope);
      if (node.block) analyzeBlock(node.block, scope);
      return;
    }
    case 'If': {
      analyze(node.cond, scope);
      analyze(node.then, scope);
      for (const e of node.elifs) { analyze(e.cond, scope); analyze(e.body, scope); }
      analyze(node.elseBody, scope);
      return;
    }
    case 'Case': {
      analyze(node.subject, scope);
      for (const w of node.whens) { analyze(w.conds, scope); analyze(w.body, scope); }
      analyze(node.elseBody, scope);
      return;
    }
    case 'CaseMatch': {
      analyze(node.subject, scope);
      for (const cl of node.ins) {
        declarePattern(cl.pattern, scope);
        analyze(cl.guard, scope);
        analyze(cl.body, scope);
      }
      analyze(node.elseBody, scope);
      return;
    }
    case 'MatchPred': case 'MatchAssign': {
      analyze(node.subject, scope);
      declarePattern(node.pattern, scope);
      return;
    }
    case 'Begin': {
      analyze(node.body, scope);
      for (const r of node.rescues) {
        analyze(r.classes, scope);
        if (r.varName) declareLocal(scope, r.varName);
        analyze(r.body, scope);
      }
      analyze(node.elseBody, scope);
      analyze(node.ensureBody, scope);
      return;
    }
    default: {
      for (const k of Object.keys(node)) {
        if (k === 'type' || k.startsWith('__')) continue;
        analyze(node[k], scope);
      }
    }
  }
}

function declareTarget(scope, t) {
  if (t.type === 'Ident') declareLocal(scope, t.name);
  else if (t.type === 'SplatTarget') { if (t.target) declareTarget(scope, t.target); }
  else if (t.type === 'MlhsGroup') { for (const sub of t.targets) declareTarget(scope, sub); }
  else analyze(t, scope);
}

// Declare every variable a pattern binds, and analyze its embedded expressions.
function declarePattern(pat, scope) {
  if (!pat) return;
  switch (pat.type) {
    case 'PVar': declareLocal(scope, pat.name); break;
    case 'PBind': declareLocal(scope, pat.name); declarePattern(pat.pattern, scope); break;
    case 'PAlt': pat.options.forEach((o) => declarePattern(o, scope)); break;
    case 'PArr':
      pat.pre.forEach((x) => declarePattern(x, scope));
      pat.post.forEach((x) => declarePattern(x, scope));
      if (pat.restName) declareLocal(scope, pat.restName);
      if (pat.constExpr) analyze(pat.constExpr, scope);
      break;
    case 'PFind':
      pat.mid.forEach((x) => declarePattern(x, scope));
      if (pat.preName) declareLocal(scope, pat.preName);
      if (pat.postName) declareLocal(scope, pat.postName);
      if (pat.constExpr) analyze(pat.constExpr, scope);
      break;
    case 'PHash':
      for (const pr of pat.pairs) { if (pr.value) declarePattern(pr.value, scope); else declareLocal(scope, pr.key); }
      if (pat.rest && pat.rest.name) declareLocal(scope, pat.rest.name);
      if (pat.constExpr) analyze(pat.constExpr, scope);
      break;
    case 'PVal': case 'PPin': analyze(pat.expr, scope); break;
  }
}

function analyzeBlock(block, scope) {
  // Implicit block parameters (`_1`..`_9`, `it`) when no explicit params: turn
  // them into real positional params so the normal binding (incl. auto-splat
  // of a single array arg into `_1`/`_2`/...) applies.
  if (!block.params || block.params.length === 0) {
    const found = findImplicitParams(block.body);
    if (found.max > 0) block.params = Array.from({ length: found.max }, (_, i) => ({ kind: 'req', name: '_' + (i + 1) }));
    else if (found.it) block.params = [{ kind: 'req', name: 'it' }];
  }
  const params = collectParamNames(block.params);
  const s = new Scope('block', scope, params);
  block.__scope = s;
  analyzeParams(block.params, s);
  analyze(block.body, s);
}

// Scan a block body for implicit-parameter references, without descending into
// nested scopes (each block/lambda/def has its own `_1`/`it`).
function findImplicitParams(node, acc = { max: 0, it: false }) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { for (const n of node) findImplicitParams(n, acc); return acc; }
  if (node.type === 'Ident') {
    if (/^_[1-9]$/.test(node.name)) acc.max = Math.max(acc.max, +node.name[1]);
    else if (node.name === 'it') acc.it = true;
    return acc;
  }
  if (['Lambda', 'Def', 'Class', 'Module', 'SingletonClass'].includes(node.type)) return acc;
  for (const k of Object.keys(node)) {
    if (k === 'type' || k.startsWith('__')) continue;
    if ((node.type === 'Call' || node.type === 'Super') && k === 'block') continue;
    findImplicitParams(node[k], acc);
  }
  return acc;
}

function analyzeParams(params, scope) {
  for (const p of params) {
    if (p.kind === 'opt' || p.kind === 'key') analyze(p.default, scope);
    if (p.kind === 'destructure') for (const n of collectParamNames(p.names)) scope.vars.add(n);
  }
}

function collectParamNames(params) {
  const names = [];
  for (const p of params || []) {
    if (p.kind === 'destructure') names.push(...collectParamNames(p.names));
    else if (p.name) names.push(p.name);
  }
  return names;
}

// Proc/lambda arity per Ruby rules. Count = required positional (+1 if any
// required keyword). The result is negated and decremented when the count is
// "variable": rest/kwrest/optional-keyword always make it variable; an optional
// positional makes it variable only for lambdas (non-lambda procs report the
// mandatory count instead — the documented Proc#arity exception).
function procArity(params) {
  let req = 0, opt = false, rest = false, reqKey = 0, optKey = false, kwrest = false;
  for (const p of params || []) {
    if (p.kind === 'req' || p.kind === 'destructure') req++;
    else if (p.kind === 'opt') opt = true;
    else if (p.kind === 'rest') rest = true;
    else if (p.kind === 'key') { if (p.default == null) reqKey++; else optKey = true; }
    else if (p.kind === 'kwrest') kwrest = true;
  }
  const n = req + (reqKey > 0 ? 1 : 0);
  // n = mandatory count; v = variable regardless of proc/lambda; o = has an
  // optional positional (only makes a lambda variable). Resolved at call time.
  return `{n:${n},v:${rest || kwrest || optKey},o:${opt}}`;
}

// ---- Pass 2: code generation ---------------------------------------------
export class Compiler {
  constructor() {
    this.tmp = 0;
    this.scope = null;
    this.classRef = '$cls';
    this.methodName = null;
    this.methodParams = null;
    this.ctx = []; // 'loop' | 'block'
    // Current JS expression for Ruby `self`. Method bodies use the `$self`
    // parameter; blocks/lambdas use a rebindable `$sfN` (so instance_eval /
    // define_method can rebind self via the block's second argument).
    this.selfRef = '$self';
    // Lexical class/module nesting as cumulative "Foo::Bar" paths (outermost
    // first). Baked into constant lookups so `VERSION` inside `module Foo`
    // resolves to Foo::VERSION before any global VERSION.
    this.nesting = [];
  }

  nestingJson() { return JSON.stringify(this.nesting); }

  t() { return '$t' + (++this.tmp); }
  q(s) { return JSON.stringify(s); }
  // Mangle Ruby locals into a private namespace so they can never collide with
  // compiler-internal variables ($self, $args, $blk, $i, $pos, $kw, …).
  local(name) { return '$r_' + name; }

  compileProgram(program) {
    this.scope = program.__scope;
    const decls = this.declList(program.__scope);
    const body = this.genStmts(program.body);
    return [
      'const $self = R.main;',
      'const $blk = null;',
      'const $cls = R.consts.get("Object");',
      'const $frame = R.nextFrame();',
      decls,
      body,
    ].filter(Boolean).join('\n');
  }

  declList(scope) {
    const owned = [...scope.vars].filter((v) => !scope.params.has(v));
    if (owned.length === 0) return '';
    return 'let ' + owned.map((v) => this.local(v) + ' = null').join(', ') + ';';
  }

  // Statements in side-effect position.
  genStmts(stmts) {
    return stmts.map((s) => this.genStmt(s)).join('\n');
  }

  genStmt(node) {
    switch (node.type) {
      case 'If': return this.genIfStmt(node);
      case 'While': return this.genWhileStmt(node);
      case 'For': return this.genForStmt(node);
      case 'Case': return this.genCaseStmt(node);
      case 'CaseMatch': return this.genCaseMatchStmt(node);
      case 'Begin': return this.genBeginStmt(node);
      case 'Return': return this.genReturn(node);
      case 'Break': return this.genBreak(node);
      case 'Next': return this.genNext(node);
      case 'Redo': return 'throw new R.RedoError();';
      case 'Retry': return 'throw new R.RetryError();';
      case 'Class': return this.genClass(node) + ';';
      case 'Module': return this.genModule(node) + ';';
      case 'Def': return this.gen(node) + ';';
      default: return this.gen(node) + ';';
    }
  }

  // Body of a function scope: declarations + statements; last yields a value.
  genFnBody(stmts, scope, { wrapReturn }) {
    const decls = this.declList(scope);
    const inner = this.genReturningBody(stmts);
    let body = [decls, inner].filter(Boolean).join('\n');
    if (wrapReturn) {
      // Each method/lambda gets a fresh frame id; a `return` (here or in a nested
      // block) carries the frame of the method it lexically belongs to. We only
      // unwind here when the frame matches ours — otherwise it's a block's return
      // targeting an outer method, so let it propagate.
      body = `const $frame = R.nextFrame();\ntry {\n${body}\n} catch ($e) { if ($e instanceof R.ReturnError) { if ($e.frame === $frame) return $e.value; throw $e; } throw $e; }`;
    }
    return body;
  }

  // Emit statements where the final statement's value is returned.
  genReturningBody(stmts) {
    if (stmts.length === 0) return 'return null;';
    const out = [];
    for (let i = 0; i < stmts.length - 1; i++) out.push(this.genStmt(stmts[i]));
    const last = stmts[stmts.length - 1];
    out.push(this.genReturnStmt(last));
    return out.join('\n');
  }

  // Like genStmt but the last statement returns its value.
  genReturnStmt(node) {
    switch (node.type) {
      case 'Return': return this.genReturn(node);
      case 'Break': return this.genBreak(node);
      case 'Next': return this.genNext(node);
      case 'If': return this.genIfReturn(node);
      case 'Case': return this.genCaseReturn(node);
      case 'CaseMatch': return this.genCaseMatchReturn(node);
      case 'Begin': return 'return ' + this.gen(node) + ';';
      case 'While': return this.genWhileStmt(node) + '\nreturn null;';
      case 'For': return this.genForStmt(node) + '\nreturn null;';
      case 'Class': return 'return ' + this.genClass(node) + ';';
      case 'Module': return 'return ' + this.genModule(node) + ';';
      default: return 'return ' + this.gen(node) + ';';
    }
  }

  // ---- expressions --------------------------------------------------------
  gen(node) {
    switch (node.type) {
      case 'IntLit': return typeof node.value === 'bigint' ? `${node.value}n` : String(node.value);
      case 'FloatLit': return `R.float(${node.value})`;
      case 'MatchPred': case 'MatchAssign': return this.genMatchOp(node);
      case 'RationalLit': return `R.rational(${node.num}, ${node.den})`;
      case 'ImaginaryLit': return `R.complex(0, ${node.rational ? `R.rational(${node.num}, ${node.den})` : (node.isFloat ? `R.float(${node.value})` : String(node.value))})`;
      case 'StrLit': return this.genStr(node);
      case 'SymLit': return `R.sym(${this.q(node.name)})`;
      case 'DSym': return `R.sym(R.interp(${this.gen(node.str)}))`;
      case 'RegexLit': return this.genRegex(node);
      case 'NilLit': return 'null';
      case 'BoolLit': return node.value ? 'true' : 'false';
      case 'Self': return this.selfRef;
      case 'MethodName': return this.methodName ? `R.sym(${this.q(this.methodName)})` : 'null';
      case 'ArrayLit': return this.genArrayLit(node);
      case 'HashLit': return this.genHashLit(node);
      case 'Ident': return this.genIdent(node);
      case 'IVar': return `R.ivarGet(${this.selfRef}, ${this.q(node.name)})`;
      case 'CVar': return `R.cvarGet(${this.classRef}, ${this.q(node.name)})`;
      case 'GVar': return `R.gvarGet(${this.q(node.name)})`;
      case 'Const': return node.topLevel
        ? `R.constGet(${this.q(node.name)})`
        : `R.constResolve(${this.nestingJson()}, ${this.classRef}, ${this.q(node.name)})`;
      case 'ConstPath': return `R.constGetFrom(${this.gen(node.base)}, ${this.q(node.name)})`;
      case 'Assign': return this.genAssign(node);
      case 'OpAssign': return this.genOpAssign(node);
      case 'MultiAssign': return this.genMultiAssign(node);
      case 'BinOp': return `R.send(${this.gen(node.left)}, ${this.q(node.op)}, [${this.gen(node.right)}])`;
      case 'Logical': return this.genLogical(node);
      case 'UnaryOp': return this.genUnary(node);
      case 'Not': return `R.not(${this.gen(node.operand)})`;
      case 'Range': return `R.range(${node.from ? this.gen(node.from) : 'null'}, ${node.to ? this.gen(node.to) : 'null'}, ${node.exclusive})`;
      case 'Ternary': return `(R.truthy(${this.gen(node.cond)}) ? ${this.gen(node.then)} : ${this.gen(node.else)})`;
      case 'Call': return this.genCall(node);
      case 'Index': return `R.send(${this.gen(node.receiver)}, "[]", [${this.genArgs(node.args)}])`;
      case 'If': return this.genIfExpr(node);
      case 'Case': return this.genCaseExpr(node);
      case 'CaseMatch': return this.genCaseMatchExpr(node);
      case 'While': return this.genWhileExpr(node);
      case 'Begin': return this.genBeginExpr(node);
      case 'Def': return this.genDef(node);
      case 'Class': return this.genClass(node);
      case 'Module': return this.genModule(node);
      case 'SingletonClass': return this.genSingletonClass(node);
      case 'Lambda': return this.genLambda(node);
      case 'Yield': return this.genYield(node);
      case 'Super': return this.genSuper(node);
      case 'Return': return this.iife(this.genReturn(node));
      case 'Break': return this.iife(this.genBreak(node));
      case 'Next': return this.iife(this.genNext(node));
      case 'Defined': return this.genDefined(node);
      case 'Attr': return `R.defineAttr(R.currentDefinee(), ${this.q(node.kind)}, ${JSON.stringify(node.names)})`;
      case 'Alias': return `R.send(R.currentDefinee(), "alias_method", [R.sym(${this.q(node.newName)}), R.sym(${this.q(node.oldName)})])`;
      case 'Splat': return `...R.splat(${this.gen(node.value)})`;
      case 'BlockPass': return this.gen(node.value);
      default:
        throw new Error('Cannot compile node type: ' + node.type);
    }
  }

  iife(stmt) { return `(() => { ${stmt} })()`; }

  // Run `fn` with the code-gen scope state swapped to a nested scope, restoring
  // the previous state afterwards. `ctx`/`classRef`/`selfRef` are evaluated by
  // the caller (so block ctx can extend the current ctx before the swap).
  withScope(scope, ctx, classRef, selfRef, fn) {
    const ps = this.scope, pc = this.ctx, pcr = this.classRef, psf = this.selfRef;
    this.scope = scope; this.ctx = ctx; this.classRef = classRef; this.selfRef = selfRef;
    try { return fn(); } finally {
      this.scope = ps; this.ctx = pc; this.classRef = pcr; this.selfRef = psf;
    }
  }

  // Emit a `function ($self, $args, $blk) {...}` for a def/singleton-def body.
  genMethodFn(node) {
    const prevMethod = this.methodName, prevParams = this.methodParams;
    this.methodName = node.name;
    this.methodParams = node.params;
    const fn = this.withScope(node.__scope, ['method'], '$dc', '$self', () => {
      const bind = this.genParamBinding(node.params, false);
      const body = this.genFnBody(node.body, node.__scope, { wrapReturn: true });
      return `function ($self, $args, $blk) {\n${bind}\n${body}\n}`;
    });
    this.methodName = prevMethod;
    this.methodParams = prevParams;
    return fn;
  }

  // Reconstruct the argument list a bare `super` forwards: the *current* values
  // of the enclosing method's parameters (so applied defaults are included).
  superForwardArgs() {
    const params = this.methodParams;
    if (!params) return '$args';
    const pos = []; const kw = [];
    for (const p of params) {
      if (p.kind === 'req' || p.kind === 'opt') pos.push(this.local(p.name));
      else if (p.kind === 'rest') { if (p.name) pos.push(`...R.splat(${this.local(p.name)})`); }
      else if (p.kind === 'destructure') { /* uncommon in super forwarding */ }
      else if (p.kind === 'key') kw.push(`[R.sym(${this.q(p.name)}), ${this.local(p.name)}]`);
      else if (p.kind === 'kwrest') { if (p.name) kw.push(`...${this.local(p.name)}.entries()`); }
    }
    if (kw.length) pos.push(`R.hash([${kw.join(', ')}])`);
    return `[${pos.join(', ')}]`;
  }

  // Emit a `function ($cls) {...}` class/module body builder. `nestingPath` is
  // pushed onto the lexical nesting while emitting (null for a singleton class).
  genClassBuilder(scope, body, nestingPath) {
    return this.withScope(scope, ['method'], '$cls', '$self', () => {
      if (nestingPath !== null) this.nesting.push(nestingPath);
      const decls = this.declList(scope);
      const inner = this.genReturningBody(body);
      if (nestingPath !== null) this.nesting.pop();
      return `function ($cls) {\nconst $self = $cls;\nconst $blk = null;\n${decls}\n${inner}\n}`;
    });
  }

  genRegex(node) {
    let src;
    if (node.parts.length === 1 && 'str' in node.parts[0]) src = this.q(node.parts[0].str);
    else src = node.parts.map((p) => 'str' in p ? this.q(p.str) : `R.interp(${this.gen(p.node)})`).join(' + ');
    return `R.regexp(${src}, ${this.q(node.flags)})`;
  }

  genStr(node) {
    if (node.parts.length === 1 && 'str' in node.parts[0]) {
      return `R.str(${this.q(node.parts[0].str)})`;
    }
    const pieces = node.parts.map((p) =>
      'str' in p ? this.q(p.str) : `R.interp(${this.gen(p.node)})`);
    return `R.str(${pieces.join(' + ')})`;
  }

  genArrayLit(node) {
    return '[' + node.elements.map((e) =>
      e.type === 'Splat' ? `...R.splat(${this.gen(e.value)})` : this.gen(e)).join(', ') + ']';
  }

  genHashLit(node) {
    const pairs = [];
    const splats = [];
    for (const p of node.pairs) {
      if (p.doubleSplat) splats.push(this.gen(p.doubleSplat));
      else pairs.push(`[${this.gen(p.key)}, ${this.gen(p.value)}]`);
    }
    let expr = `R.hash([${pairs.join(', ')}])`;
    if (splats.length) expr = `R.hashMerge(${expr}, ${splats.join(', ')})`;
    return expr;
  }

  genIdent(node) {
    if (node.name === 'block_given?') return '($blk !== null && $blk !== undefined)';
    if (node.name === '__method__') return this.methodName ? `R.sym(${this.q(this.methodName)})` : 'null';
    if (node.name === '__FILE__') return 'R.currentFile()';
    if (node.name === '__LINE__') return '0';
    if (isVisible(this.scope, node.name)) return this.local(node.name);
    return `R.send(${this.selfRef}, ${this.q(node.name)}, [])`;
  }

  genArgs(args) {
    return args.map((a) => {
      if (a.type === 'Splat') return `...R.splat(${this.gen(a.value)})`;
      if (a.type === 'DoubleSplat') return this.gen(a.value);
      return this.gen(a);
    }).join(', ');
  }

  genBlockArg(node) {
    if (node.block) return this.genBlockNode(node.block);
    if (node.blockArg) return `R.toProc(${this.gen(node.blockArg)})`;
    return null;
  }

  genCall(node) {
    if (node.receiver === null) {
      if (node.name === 'block_given?') return '($blk !== null && $blk !== undefined)';
    }
    const recv = node.receiver ? this.gen(node.receiver) : this.selfRef;
    const args = this.genArgs(node.args);
    const block = this.genBlockArg(node);
    const blockArg = block ? `, ${block}` : '';
    if (node.safe) {
      const tv = this.t();
      return `((${tv}) => ${tv} === null || ${tv} === undefined ? null : R.send(${tv}, ${this.q(node.name)}, [${args}]${blockArg}))(${recv})`;
    }
    return `R.send(${recv}, ${this.q(node.name)}, [${args}]${blockArg})`;
  }

  genLogical(node) {
    const l = this.gen(node.left);
    const r = this.gen(node.right);
    if (node.op === '&&') return `R.and(${l}, () => (${r}))`;
    return `R.or(${l}, () => (${r}))`;
  }

  genUnary(node) {
    if (node.op === '!') return `R.not(${this.gen(node.operand)})`;
    const m = node.op === '-' ? '-@' : node.op === '+' ? '+@' : node.op;
    return `R.send(${this.gen(node.operand)}, ${this.q(m)}, [])`;
  }

  // ---- assignment ---------------------------------------------------------
  genAssign(node) {
    return this.assignTo(node.target, this.gen(node.value));
  }

  assignTo(target, vexpr) {
    switch (target.type) {
      case 'Ident': {
        declareLocal(this.scope, target.name);
        return `(${this.local(target.name)} = ${vexpr})`;
      }
      case 'IVar': return `R.ivarSet(${this.selfRef}, ${this.q(target.name)}, ${vexpr})`;
      case 'GVar': return `R.gvarSet(${this.q(target.name)}, ${vexpr})`;
      case 'CVar': return `R.cvarSet(${this.classRef}, ${this.q(target.name)}, ${vexpr})`;
      case 'Const': return `R.constSet(${this.q(target.name)}, ${vexpr})`;
      case 'Index': {
        const v = this.t();
        return `((${v}) => (R.send(${this.gen(target.receiver)}, "[]=", [${this.genArgs(target.args)}, ${v}]), ${v}))(${vexpr})`;
      }
      case 'Call': {
        const v = this.t();
        return `((${v}) => (R.send(${this.gen(target.receiver)}, ${this.q(target.name + '=')}, [${v}]), ${v}))(${vexpr})`;
      }
      default:
        throw new Error('Cannot assign to ' + target.type);
    }
  }

  readTarget(target) {
    switch (target.type) {
      case 'Ident': return this.local(target.name);
      case 'IVar': return `R.ivarGet(${this.selfRef}, ${this.q(target.name)})`;
      case 'GVar': return `R.gvarGet(${this.q(target.name)})`;
      case 'CVar': return `R.cvarGet(${this.classRef}, ${this.q(target.name)})`;
      case 'Const': return `R.constResolve(${this.nestingJson()}, ${this.classRef}, ${this.q(target.name)})`;
      case 'Index': return `R.send(${this.gen(target.receiver)}, "[]", [${this.genArgs(target.args)}])`;
      case 'Call': return `R.send(${this.gen(target.receiver)}, ${this.q(target.name)}, [])`;
      default: throw new Error('Cannot read target ' + target.type);
    }
  }

  genOpAssign(node) {
    if (node.target.type === 'Ident') declareLocal(this.scope, node.target.name);
    const read = this.readTarget(node.target);
    if (node.op === '||') {
      return `(R.truthy(${read}) ? ${read} : ${this.assignTo(node.target, this.gen(node.value))})`;
    }
    if (node.op === '&&') {
      return `(R.truthy(${read}) ? ${this.assignTo(node.target, this.gen(node.value))} : ${read})`;
    }
    const combined = `R.send(${read}, ${this.q(node.op)}, [${this.gen(node.value)}])`;
    return this.assignTo(node.target, combined);
  }

  genMultiAssign(node) {
    let rhs;
    if (node.values.length === 1 && node.values[0].type !== 'Splat') {
      rhs = this.gen(node.values[0]);
    } else {
      rhs = '[' + node.values.map((v) =>
        v.type === 'Splat' ? `...R.splat(${this.gen(v.value)})` : this.gen(v)).join(', ') + ']';
    }
    return this.genDestructure(node.targets, rhs);
  }

  genDestructure(targets, rhsExpr) {
    const splatIndex = targets.findIndex((t) => t.type === 'SplatTarget');
    const count = targets.length;
    const d = this.t();
    const assigns = targets.map((t, i) => {
      const valExpr = `${d}[${i}]`;
      if (t.type === 'SplatTarget') return t.target ? this.assignTo(t.target, valExpr) : '';
      if (t.type === 'MlhsGroup') return this.genDestructure(t.targets, valExpr);
      return this.assignTo(t, valExpr);
    }).filter(Boolean);
    return `(() => { const ${d} = R.destructure(${rhsExpr}, ${count}, ${splatIndex}); ${assigns.map((a) => a + ';').join(' ')} return ${d}; })()`;
  }

  // ---- control flow -------------------------------------------------------
  genIfStmt(node) {
    let out = `if (R.truthy(${this.gen(node.cond)})) {\n${this.genStmts(node.then)}\n}`;
    for (const e of node.elifs) {
      out += ` else if (R.truthy(${this.gen(e.cond)})) {\n${this.genStmts(e.body)}\n}`;
    }
    if (node.elseBody) out += ` else {\n${this.genStmts(node.elseBody)}\n}`;
    return out;
  }

  genIfReturn(node) {
    let out = `if (R.truthy(${this.gen(node.cond)})) {\n${this.genReturningBody(node.then)}\n}`;
    for (const e of node.elifs) {
      out += ` else if (R.truthy(${this.gen(e.cond)})) {\n${this.genReturningBody(e.body)}\n}`;
    }
    out += ` else {\n${node.elseBody ? this.genReturningBody(node.elseBody) : 'return null;'}\n}`;
    return out;
  }

  genIfExpr(node) {
    // simple cond?then:else when both branches are single expressions
    return `(() => {\n${this.genIfReturn(node)}\n})()`;
  }

  genWhileStmt(node) {
    this.ctx.push('loop');
    const body = this.genStmts(node.body);
    this.ctx.pop();
    const cond = `R.truthy(${this.gen(node.cond)})`;
    const test = node.isUntil ? `!(${cond})` : cond;
    if (node.doWhile) {
      return `do {\n${body}\n} while (${test});`;
    }
    return `while (${test}) {\n${body}\n}`;
  }

  genWhileExpr(node) {
    return `(() => { ${this.genWhileStmt(node)} return null; })()`;
  }

  genForStmt(node) {
    const e = this.t();
    this.ctx.push('loop');
    let assign;
    if (node.vars.length === 1) {
      assign = `${this.local(node.vars[0])} = ${e};`;
    } else {
      const dt = this.t();
      assign = `const ${dt} = R.toArray(${e}); ` +
        node.vars.map((v, i) => `${this.local(v)} = ${dt}[${i}] ?? null;`).join(' ');
    }
    const body = this.genStmts(node.body);
    this.ctx.pop();
    return `for (const ${e} of R.toArray(${this.gen(node.iter)})) {\n${assign}\n${body}\n}`;
  }

  genReturn(node) {
    const v = node.value ? this.gen(node.value) : 'null';
    // $frame is the lexically-enclosing method/lambda/top-level frame; a block
    // captures it via closure so its `return` targets the defining method.
    return `throw new R.ReturnError(${v}, $frame);`;
  }

  genBreak(node) {
    const v = node.value ? this.gen(node.value) : 'null';
    const top = this.ctx[this.ctx.length - 1];
    if (top === 'loop') return 'break;';
    return `throw new R.BreakError(${v});`;
  }

  genNext(node) {
    const v = node.value ? this.gen(node.value) : 'null';
    const top = this.ctx[this.ctx.length - 1];
    if (top === 'loop') return 'continue;';
    return `return ${v};`;
  }

  // ---- case / when --------------------------------------------------------
  genCaseStmt(node) { return this.caseToJs(node, false); }
  genCaseReturn(node) { return this.caseToJs(node, true); }
  genCaseExpr(node) { return `(() => {\n${this.caseToJs(node, true)}\n})()`; }

  // ---- pattern matching (`case/in`) ---------------------------------------
  genCaseMatchStmt(node) { return `(() => {\n${this.caseMatchToJs(node, false)}\n})();`; }
  genCaseMatchReturn(node) { return this.caseMatchToJs(node, true); }
  genCaseMatchExpr(node) { return `(() => {\n${this.caseMatchToJs(node, true)}\n})()`; }

  caseMatchToJs(node, ret) {
    const emit = (body) => (ret ? this.genReturningBody(body) : `${this.genStmts(body)}\nreturn;`);
    const sv = this.t(); const bv = this.t();
    let out = `const ${sv} = ${this.gen(node.subject)};\nlet ${bv};\n`;
    for (const cl of node.ins) {
      const names = [...new Set(this.collectBinds(cl.pattern))];
      const assign = names.map((n) => `${this.local(n)} = ${bv}[${this.q(n)}] ?? null;`).join(' ');
      out += `if ((${bv} = R.patMatch(${sv}, ${this.genPat(cl.pattern)}, {})) !== false) {\n${assign}\n`;
      if (cl.guard) {
        const g = cl.guardKind === 'unless' ? `!R.truthy(${this.gen(cl.guard)})` : `R.truthy(${this.gen(cl.guard)})`;
        out += `if (${g}) {\n${emit(cl.body)}\n}\n`;
      } else {
        out += `${emit(cl.body)}\n`;
      }
      out += `}\n`;
    }
    if (node.elseBody) out += `${emit(node.elseBody)}\n`;
    else out += `R.raisePatternError(${sv});\n`;
    return out;
  }

  genMatchOp(node) {
    const sv = this.t(); const bv = this.t();
    const names = [...new Set(this.collectBinds(node.pattern))];
    const assign = names.map((n) => `${this.local(n)} = ${bv}[${this.q(n)}] ?? null;`).join(' ');
    const match = `const ${sv} = ${this.gen(node.subject)};\nlet ${bv} = R.patMatch(${sv}, ${this.genPat(node.pattern)}, {});`;
    if (node.type === 'MatchPred') {
      return `(() => {\n${match}\nif (${bv} === false) return false;\n${assign}\nreturn true;\n})()`;
    }
    return `(() => {\n${match}\nif (${bv} === false) R.raisePatternError(${sv});\n${assign}\nreturn null;\n})()`;
  }

  genPat(p) {
    const cThunk = (cp) => (cp ? `() => ${this.gen(cp)}` : 'null');
    switch (p.type) {
      case 'PVal': case 'PPin': return `{k:"val",f:() => ${this.gen(p.expr)}}`;
      case 'PVar': return `{k:"var",n:${this.q(p.name)}}`;
      case 'PBind': return `{k:"bind",n:${this.q(p.name)},p:${this.genPat(p.pattern)}}`;
      case 'PAlt': return `{k:"alt",opts:[${p.options.map((o) => this.genPat(o)).join(',')}]}`;
      case 'PArr': return `{k:"arr",pre:[${p.pre.map((x) => this.genPat(x)).join(',')}],hasRest:${!!p.hasRest},restName:${p.restName ? this.q(p.restName) : 'null'},post:[${p.post.map((x) => this.genPat(x)).join(',')}],c:${cThunk(p.constExpr)}}`;
      case 'PFind': return `{k:"find",preName:${p.preName ? this.q(p.preName) : 'null'},mid:[${p.mid.map((x) => this.genPat(x)).join(',')}],postName:${p.postName ? this.q(p.postName) : 'null'},c:${cThunk(p.constExpr)}}`;
      case 'PHash': {
        const pairs = p.pairs.map((pr) => `{key:${this.q(pr.key)},val:${pr.value ? this.genPat(pr.value) : 'null'}}`).join(',');
        const restKind = p.rest === undefined ? '"none"' : (p.rest === null ? '"nil"' : '"rest"');
        const restName = (p.rest && p.rest.name) ? this.q(p.rest.name) : 'null';
        return `{k:"hash",pairs:[${pairs}],restKind:${restKind},restName:${restName},c:${cThunk(p.constExpr)}}`;
      }
    }
    throw new Error('Cannot compile pattern: ' + p.type);
  }

  collectBinds(p) {
    switch (p.type) {
      case 'PVar': return [p.name];
      case 'PBind': return [p.name, ...this.collectBinds(p.pattern)];
      case 'PAlt': return p.options.flatMap((o) => this.collectBinds(o));
      case 'PArr': { const b = [...p.pre, ...p.post].flatMap((x) => this.collectBinds(x)); if (p.restName) b.push(p.restName); return b; }
      case 'PFind': { const b = p.mid.flatMap((x) => this.collectBinds(x)); if (p.preName) b.push(p.preName); if (p.postName) b.push(p.postName); return b; }
      case 'PHash': { const b = []; for (const pr of p.pairs) { if (pr.value) b.push(...this.collectBinds(pr.value)); else b.push(pr.key); } if (p.rest && p.rest.name) b.push(p.rest.name); return b; }
      default: return [];
    }
  }

  caseToJs(node, ret) {
    const emit = (body) => (ret ? this.genReturningBody(body) : this.genStmts(body));
    const subj = node.subject ? this.gen(node.subject) : null;
    const sv = subj ? this.t() : null;
    let out = subj ? `const ${sv} = ${subj};\n` : '';
    let first = true;
    for (const w of node.whens) {
      const conds = w.conds.map((c) => {
        if (c.type === 'Splat') {
          return subj
            ? `R.splat(${this.gen(c.value)}).some((x) => R.truthy(R.send(x, "===", [${sv}])))`
            : `R.splat(${this.gen(c.value)}).some((x) => R.truthy(x))`;
        }
        return subj
          ? `R.truthy(R.send(${this.gen(c)}, "===", [${sv}]))`
          : `R.truthy(${this.gen(c)})`;
      }).join(' || ');
      out += `${first ? '' : 'else '}if (${conds}) {\n${emit(w.body)}\n}\n`;
      first = false;
    }
    if (node.elseBody) out += `else {\n${emit(node.elseBody)}\n}\n`;
    else if (ret) out += `else { return null; }\n`;
    return out;
  }

  // ---- begin / rescue -----------------------------------------------------
  genBeginStmt(node) { return this.beginToJs(node, false); }
  genBeginExpr(node) { return `(() => {\n${this.beginToJs(node, true)}\n})()`; }

  beginToJs(node, ret) {
    const emit = (body) => (ret ? this.genReturningBody(body) : this.genStmts(body));
    // With an else clause, the main body runs in side-effect (non-returning)
    // position and the else clause carries the value; otherwise the body does.
    const tryBody = node.elseBody
      ? this.genStmts(node.body) + '\n' + emit(node.elseBody)
      : emit(node.body);

    const useRetry = node.rescues.some((r) => hasRetry(r.body));

    let core = tryBody;
    if (node.rescues.length) {
      core = 'try {\n' + tryBody + '\n}';
      const errv = '$err';
      core += ` catch (${errv}) {\n`;
      core += `if (${errv} instanceof R.ReturnError || ${errv} instanceof R.BreakError || ${errv} instanceof R.NextError || ${errv} instanceof R.RetryError || ${errv} instanceof R.ThrowSignal) throw ${errv};\n`;
      core += `const $exc = (${errv} instanceof R.RubyError) ? ${errv}.rubyObj : R.wrapJsError(${errv});\n`;
      // Track $! (the exception being handled) so a bare `raise` re-raises it.
      core += `const $prevExc = R.gvarGet("$!"); R.gvarSet("$!", $exc);\n`;
      core += `try {\n`;
      let first = true;
      for (const r of node.rescues) {
        let cond;
        if (r.classes.length === 0) {
          cond = `R.isA($exc, R.constGet("StandardError"))`;
        } else {
          cond = r.classes.map((c) => `R.isA($exc, ${this.gen(c)})`).join(' || ');
        }
        core += `${first ? '' : 'else '}if (${cond}) {\n`;
        if (r.varName) { declareLocal(this.scope, r.varName); core += `${this.local(r.varName)} = $exc;\n`; }
        core += emit(r.body) + '\n}\n';
        first = false;
      }
      core += `else { throw ${errv}; }\n`;
      core += `} finally { R.gvarSet("$!", $prevExc); }\n`;
      core += '}';
    }

    if (useRetry) {
      const lbl = '$retry' + (++this.tmp);
      core = `${lbl}: while (true) {\ntry {\n${core}\n} catch ($rt) {\nif ($rt instanceof R.RetryError) continue ${lbl};\nthrow $rt;\n}\nbreak ${lbl};\n}`;
    }

    let out = core;
    if (node.ensureBody) {
      out = `try {\n${core}\n} finally {\n${this.genStmts(node.ensureBody)}\n}`;
    }
    return out;
  }

  // ---- def / class / module ----------------------------------------------
  genDef(node) {
    // Capture the defining class at registration time so cvars and `super`
    // inside the method body resolve against it.
    const target = node.singleton
      ? (node.singleton.type === 'Self' ? this.selfRef : this.gen(node.singleton))
      : 'R.currentDefinee()';
    const fn = this.genMethodFn(node);
    const defFn = node.singleton ? 'defineSMethod' : 'defineMethod';
    return `(($dc) => R.${defFn}($dc, ${this.q(node.name)}, ${fn}))(${target})`;
  }

  genClass(node) {
    const superExpr = node.superclass ? this.gen(node.superclass) : 'null';
    const builder = this.genClassBuilder(node.__scope, node.body, this.childPath(node.name));
    return `R.defineClass(${this.q(node.name)}, ${superExpr}, ${builder}, null)`;
  }

  genModule(node) {
    const builder = this.genClassBuilder(node.__scope, node.body, this.childPath(node.name));
    return `R.defineModule(${this.q(node.name)}, ${builder}, null)`;
  }

  // Cumulative nesting path for a class/module body ("Geometry" + "Circle"
  // => "Geometry::Circle").
  childPath(name) {
    const parent = this.nesting.length ? this.nesting[this.nesting.length - 1] : '';
    return parent ? parent + '::' + name : name;
  }

  genSingletonClass(node) {
    // class << obj ... end — open obj's singleton class. The body runs with the
    // singleton class as the current definee, so any `def`/attr/alias (even when
    // nested in if/case/begin) becomes a singleton method on obj.
    const obj = this.gen(node.obj);
    const builder = this.genClassBuilder(node.__scope, node.body, null);
    return `R.defineSingletonClass(${obj}, ${builder})`;
  }

  genSingletonMember(node, target) {
    if (node.type === 'Def') {
      const fn = this.genMethodFn(node);
      return `(($dc) => R.defineSMethod($dc, ${this.q(node.name)}, ${fn}))(${target});`;
    }
    if (node.type === 'Alias') {
      return `R.aliasSingleton(${target}, ${this.q(node.newName)}, ${this.q(node.oldName)});`;
    }
    if (node.type === 'Attr') {
      return `R.defineAttr(${target}, ${this.q(node.kind)}, ${JSON.stringify(node.names)}, true);`;
    }
    return this.genStmt(node);
  }

  genLambda(node) {
    const scope = node.__scope;
    const prevScope = this.scope, prevCtx = this.ctx, prevSelf = this.selfRef;
    const sf = '$sf' + (++this.tmp);
    this.scope = scope; this.ctx = ['lambda']; this.selfRef = sf;
    const bind = this.genParamBinding(node.params, false);
    const body = this.genFnBody(node.body, scope, { wrapReturn: true });
    this.scope = prevScope; this.ctx = prevCtx; this.selfRef = prevSelf;
    return `R.makeProc(function ($args, $self2) {\nconst ${sf} = ($self2 == null ? ${prevSelf} : $self2);\n${bind}\n${body}\n}, true, ${procArity(node.params)})`;
  }

  genBlockNode(block) {
    const scope = block.__scope;
    const prevScope = this.scope, prevCtx = this.ctx, prevSelf = this.selfRef;
    const sf = '$sf' + (++this.tmp);
    this.scope = scope; this.ctx = [...this.ctx, 'block']; this.selfRef = sf;
    const bind = this.genParamBinding(block.params, true);
    const decls = this.declList(scope);
    const body = this.genReturningBody(block.body);
    this.scope = prevScope; this.ctx = prevCtx; this.selfRef = prevSelf;
    return `R.makeProc(function ($args, $self2) {\nconst ${sf} = ($self2 == null ? ${prevSelf} : $self2);\n${bind}\n${decls}\n${body}\n}, false, ${procArity(block.params)})`;
  }

  // ---- parameter binding --------------------------------------------------
  genParamBinding(params, isBlock) {
    if (!params || params.length === 0) return '';
    const lines = [];

    // Deduplicate params named `_` — each gets a unique temp name so `let` doesn't collide.
    const usedParamVars = new Set();
    params = params.map((p) => {
      if (!p.name) return p;
      let v = this.local(p.name);
      if (usedParamVars.has(v)) { p = { ...p, name: '_$' + (++this.tmp) }; }
      else { usedParamVars.add(v); }
      return p;
    });

    const positional = params.filter((p) => ['req', 'opt', 'rest', 'destructure'].includes(p.kind));
    const keys = params.filter((p) => p.kind === 'key');
    const kwrest = params.find((p) => p.kind === 'kwrest');
    const blockParam = params.find((p) => p.kind === 'block');

    // auto-splat for blocks with arity > 1
    const posArity = positional.length;
    if (isBlock && posArity > 1) {
      lines.push(`if ($args.length === 1 && Array.isArray($args[0])) $args = $args[0];`);
    }

    // keyword args: pull trailing hash
    if (keys.length || kwrest) {
      lines.push(`let $kw = ($args.length > ${countReqPos(positional)} && $args[$args.length - 1] instanceof R.RHash) ? $args[$args.length - 1] : null;`);
      lines.push(`let $pos = $kw ? $args.slice(0, -1) : $args;`);
    } else {
      lines.push(`let $pos = $args;`);
    }

    const restIdx = positional.findIndex((p) => p.kind === 'rest');
    const nReqBefore = restIdx < 0
      ? positional.filter((p) => p.kind === 'req' || p.kind === 'destructure').length
      : positional.slice(0, restIdx).filter((p) => p.kind === 'req' || p.kind === 'destructure').length;
    const nOpt = positional.filter((p) => p.kind === 'opt').length;
    const nReqAfter = restIdx < 0 ? 0 : positional.slice(restIdx + 1).filter((p) => p.kind === 'req' || p.kind === 'destructure').length;
    const nReqTotal = nReqBefore + nReqAfter;

    lines.push(`let $i = 0;`);
    lines.push(`let $optfill = Math.max(0, Math.min(${nOpt}, $pos.length - ${nReqTotal}));`);

    for (const p of positional) {
      if (p.kind === 'req') {
        lines.push(`let ${this.local(p.name)} = $pos[$i++];`);
        lines.push(`if (${this.local(p.name)} === undefined) ${this.local(p.name)} = null;`);
      } else if (p.kind === 'destructure') {
        const tv = this.t();
        lines.push(`let ${tv} = $pos[$i++];`);
        const inner = collectParamNames(p.names);
        const di = this.t();
        const innerSplat = p.names.findIndex((q) => q.kind === 'rest');
        lines.push(`let ${di} = R.destructure(${tv}, ${p.names.length}, ${innerSplat});`);
        p.names.forEach((q, idx) => { if (q.name) lines.push(`let ${this.local(q.name)} = ${di}[${idx}];`); });
      } else if (p.kind === 'opt') {
        lines.push(`let ${this.local(p.name)};`);
        lines.push(`if ($optfill > 0) { ${this.local(p.name)} = $pos[$i++]; $optfill--; } else { ${this.local(p.name)} = ${this.gen(p.default)}; }`);
      } else if (p.kind === 'rest') {
        const take = `$pos.length - $i - ${nReqAfter}`;
        if (p.name) lines.push(`let ${this.local(p.name)} = $pos.slice($i, $i + Math.max(0, ${take}));`);
        lines.push(`$i += Math.max(0, ${take});`);
      }
    }

    for (const p of keys) {
      const symKey = `R.sym(${this.q(p.name)})`;
      if (p.default != null) {
        lines.push(`let ${this.local(p.name)} = ($kw && $kw.has(${symKey})) ? $kw.get(${symKey}) : (${this.gen(p.default)});`);
      } else {
        lines.push(`let ${this.local(p.name)} = ($kw && $kw.has(${symKey})) ? $kw.get(${symKey}) : (() => { R.raiseError(R.constGet("ArgumentError"), "missing keyword: :${p.name}"); })();`);
      }
    }
    if (kwrest && kwrest.name) {
      lines.push(`let ${this.local(kwrest.name)} = new R.RHash();`);
      const used = keys.map((p) => `R.sym(${this.q(p.name)})`);
      lines.push(`if ($kw) { for (const $k of $kw.keys()) { if (![${used.join(', ')}].some((u) => R.rbEqual(u, $k))) ${this.local(kwrest.name)}.set($k, $kw.get($k)); } }`);
    }
    if (blockParam && blockParam.name) {
      lines.push(`let ${this.local(blockParam.name)} = $blk || null;`);
    }

    return lines.join('\n');
  }

  // ---- yield / super / defined? ------------------------------------------
  genYield(node) {
    return `R.callBlock($blk, [${this.genArgs(node.args)}])`;
  }

  genSuper(node) {
    // A block attached to `super do ... end` (or `&blk`) overrides the method's own $blk.
    const block = this.genBlockArg(node) || '$blk';
    if (node.args === null) {
      return `R.superCall(${this.selfRef}, ${this.classRef}, ${this.q(this.methodName)}, ${this.superForwardArgs()}, ${block})`;
    }
    return `R.superCall(${this.selfRef}, ${this.classRef}, ${this.q(this.methodName)}, [${this.genArgs(node.args)}], ${block})`;
  }

  genDefined(node) {
    const op = node.operand;
    if (op.type === 'Ident') {
      if (isVisible(this.scope, op.name)) return `R.str("local-variable")`;
      return `(R.respondTo(${this.selfRef}, ${this.q(op.name)}) ? R.str("method") : null)`;
    }
    if (op.type === 'IVar') return `(R.ivarGet(${this.selfRef}, ${this.q(op.name)}) !== null ? R.str("instance-variable") : null)`;
    if (op.type === 'GVar') return `(R.gvarGet(${this.q(op.name)}) !== null ? R.str("global-variable") : null)`;
    if (op.type === 'Const') return `(R.constDefined(${this.nestingJson()}, ${this.classRef}, ${this.q(op.name)}) ? R.str("constant") : null)`;
    if (op.type === 'Call') {
      const recv = op.receiver ? this.gen(op.receiver) : this.selfRef;
      return `(R.respondTo(${recv}, ${this.q(op.name)}) ? R.str("method") : null)`;
    }
    if (op.type === 'NilLit' || op.type === 'Self' || op.type === 'BoolLit') return `R.str("expression")`;
    return `R.str("expression")`;
  }
}

export function compile(source) {
  const ast = parse(source);
  analyze(ast, null);
  const compiler = new Compiler();
  return compiler.compileProgram(ast);
}

function countReqPos(positional) {
  return positional.filter((p) => p.kind === 'req' || p.kind === 'destructure').length;
}

// Does this subtree contain a `retry` for the current begin? Don't descend into
// nested scopes (def/class/module/lambda) or a nested begin.
function hasRetry(node) {
  if (node == null) return false;
  if (Array.isArray(node)) return node.some(hasRetry);
  if (typeof node !== 'object' || !node.type) return false;
  if (node.type === 'Retry') return true;
  if (['Def', 'Class', 'Module', 'Lambda', 'SingletonClass', 'Begin'].includes(node.type)) return false;
  for (const k of Object.keys(node)) {
    if (k === 'type' || k.startsWith('__')) continue;
    if (hasRetry(node[k])) return true;
  }
  return false;
}
