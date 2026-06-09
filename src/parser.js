// Parser: tokens -> AST.
//
// Recursive descent for statements & keywords, Pratt/precedence climbing for
// binary operator expressions. AST nodes are plain objects tagged with `type`.

import { tokenize } from './lexer.js';

const N = (type, props) => ({ type, ...props });

// Binary operators handled by the precedence-climbing loop (higher binds tighter).
// `**` is handled separately (right-assoc, tighter than unary) in parsePow.
const BINPREC = {
  '||': 3, '&&': 4,
  '==': 5, '!=': 5, '===': 5, '<=>': 5, '=~': 5,
  '<': 6, '<=': 6, '>': 6, '>=': 6,
  '|': 7, '^': 7,
  '&': 8,
  '<<': 9, '>>': 9,
  '+': 10, '-': 10,
  '*': 11, '/': 11, '%': 11,
};

const ASSIGN_OPS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '||=', '&&=', '|=', '&=', '^=',
  '<<=', '>>=',
]);

// Tokens that can begin a command-call argument (paren-less call).
const ARG_START_TYPES = new Set([
  'INT', 'FLOAT', 'STRING', 'SYMBOL', 'IDENT', 'CONST', 'IVAR', 'CVAR', 'GVAR',
  'LABEL', 'WORDS', 'REGEX',
]);

export class Parser {
  constructor(tokens) {
    this.toks = tokens;
    this.i = 0;
  }

  // ---- token navigation ---------------------------------------------------
  cur() { return this.toks[this.i]; }
  peek(n = 1) { return this.toks[this.i + n]; }
  advance() { return this.toks[this.i++]; }
  atType(t) { return this.cur().type === t; }
  atOp(v) { const t = this.cur(); return t.type === 'OP' && t.value === v; }
  atKw(v) { const t = this.cur(); return t.type === 'KEYWORD' && t.value === v; }
  atEOF() { return this.cur().type === 'EOF'; }

  error(msg) {
    const t = this.cur();
    throw new SyntaxError(`Parse error (line ${t ? t.line : '?'}): ${msg} (got ${t ? t.type + ' ' + JSON.stringify(t.value) : 'EOF'})`);
  }

  expectOp(v) {
    if (!this.atOp(v)) this.error(`expected '${v}'`);
    return this.advance();
  }
  expectKw(v) {
    if (!this.atKw(v)) this.error(`expected keyword '${v}'`);
    return this.advance();
  }
  expectType(t) {
    if (!this.atType(t)) this.error(`expected ${t}`);
    return this.advance();
  }

  // Skip newlines (used after operators / inside brackets where lines continue).
  skipNL() {
    while (this.atType('NEWLINE')) this.advance();
  }
  // Skip statement terminators: newlines and semicolons.
  skipTerminators() {
    while (this.atType('NEWLINE') || this.atOp(';')) this.advance();
  }

  // ---- entry --------------------------------------------------------------
  parseProgram() {
    const body = this.parseStatements(() => this.atEOF());
    return N('Program', { body });
  }

  // Parse statements until `stop()` is true. `stop` typically checks for a
  // closing keyword like `end`, `else`, `when`, `}`…
  parseStatements(stop) {
    const stmts = [];
    this.skipTerminators();
    while (!stop() && !this.atEOF()) {
      stmts.push(this.parseStatement());
      // require a terminator between statements (or the stop boundary)
      if (this.atType('NEWLINE') || this.atOp(';')) {
        this.skipTerminators();
      } else if (!stop() && !this.atEOF()) {
        // allow `end`/closing tokens without a leading newline
        if (this.atKw('end') || this.atOp('}')) break;
        this.error('expected newline or ; between statements');
      }
    }
    return stmts;
  }

  parseStatement() {
    let node = this.tryMultiAssign();
    if (!node) node = this.parseExpression();
    // statement modifiers: EXPR if COND / unless / while / until / rescue
    while (true) {
      if (this.atKw('if')) {
        this.advance();
        const cond = this.parseExpression();
        node = N('If', { cond, then: [node], elifs: [], elseBody: null });
      } else if (this.atKw('unless')) {
        this.advance();
        const cond = this.parseExpression();
        node = N('If', { cond: N('Not', { operand: cond }), then: [node], elifs: [], elseBody: null });
      } else if (this.atKw('while')) {
        this.advance();
        const cond = this.parseExpression();
        node = N('While', { cond, body: [node], isUntil: false, doWhile: this.isBeginBlock(node) });
      } else if (this.atKw('until')) {
        this.advance();
        const cond = this.parseExpression();
        node = N('While', { cond, body: [node], isUntil: true, doWhile: this.isBeginBlock(node) });
      } else if (this.atKw('rescue')) {
        this.advance();
        const handler = this.parseExpression();
        node = N('Begin', {
          body: [node], rescues: [{ classes: [], varName: null, body: [handler] }],
          elseBody: null, ensureBody: null,
        });
      } else break;
    }
    return node;
  }

  isBeginBlock(node) {
    return node && node.type === 'Begin';
  }

  // ---- multiple assignment (a, b = ...) -----------------------------------
  tryMultiAssign() {
    const start = this.i;
    let targets;
    try {
      targets = [this.parseMlhsItem()];
      let sawComma = false;
      while (this.atOp(',')) {
        sawComma = true;
        this.advance();
        if (this.atOp('=')) break; // trailing comma form
        targets.push(this.parseMlhsItem());
      }
      const grouped = targets[0].type === 'MlhsGroup' || targets[0].type === 'SplatTarget';
      if (!this.atOp('=') || (!sawComma && !grouped)) { this.i = start; return null; }
      this.advance(); // '='
      this.skipNL();
      const values = [this.parseTernary()];
      while (this.atOp(',')) {
        this.advance();
        this.skipNL();
        values.push(this.parseSplatOrExpr());
      }
      return N('MultiAssign', { targets, values });
    } catch (e) {
      this.i = start;
      return null;
    }
  }

  parseSplatOrExpr() {
    if (this.atOp('*')) { this.advance(); return N('Splat', { value: this.parseTernary() }); }
    return this.parseTernary();
  }

  // A single left-hand-side target for multiple assignment.
  parseMlhsItem() {
    if (this.atOp('*')) {
      this.advance();
      if (this.atOp(',') || this.atOp('=')) return N('SplatTarget', { target: null });
      return N('SplatTarget', { target: this.parseLValue() });
    }
    if (this.atOp('(')) {
      this.advance();
      const targets = [this.parseMlhsItem()];
      while (this.atOp(',')) { this.advance(); if (this.atOp(')')) break; targets.push(this.parseMlhsItem()); }
      this.expectOp(')');
      return N('MlhsGroup', { targets });
    }
    return this.parseLValue();
  }

  // Restricted parse for assignment targets: name / @ivar / Const / a.b / a[i].
  parseLValue() {
    let node;
    const t = this.cur();
    if (t.type === 'IDENT') { this.advance(); node = N('Ident', { name: t.value }); }
    else if (t.type === 'IVAR') { this.advance(); node = N('IVar', { name: t.value }); }
    else if (t.type === 'CVAR') { this.advance(); node = N('CVar', { name: t.value }); }
    else if (t.type === 'GVAR') { this.advance(); node = N('GVar', { name: t.value }); }
    else if (t.type === 'CONST') { this.advance(); node = N('Const', { name: t.value }); }
    else if (t.type === 'KEYWORD' && t.value === 'self') { this.advance(); node = N('Self', {}); }
    else this.error('invalid assignment target');
    // postfix .attr or [index]
    while (true) {
      if (this.atOp('.') || this.atOp('&.')) {
        this.advance();
        const name = this.parseMethodName();
        node = N('Call', { receiver: node, name, args: [], block: null, safe: false });
      } else if (this.atOp('[') && !this.cur().spaceBefore) {
        this.advance();
        const args = this.parseArgList(']');
        node = N('Index', { receiver: node, args });
      } else break;
    }
    return node;
  }

  // ---- expression precedence ladder --------------------------------------
  parseExpression() { return this.parseKwOr(); }

  parseKwOr() {
    let left = this.parseKwAnd();
    while (this.atKw('or')) {
      this.advance(); this.skipNL();
      left = N('Logical', { op: '||', left, right: this.parseKwAnd() });
    }
    return left;
  }
  parseKwAnd() {
    let left = this.parseKwNot();
    while (this.atKw('and')) {
      this.advance(); this.skipNL();
      left = N('Logical', { op: '&&', left, right: this.parseKwNot() });
    }
    return left;
  }
  parseKwNot() {
    if (this.atKw('not')) {
      this.advance();
      return N('Not', { operand: this.parseKwNot() });
    }
    return this.parseAssign();
  }

  parseAssign() {
    const left = this.parseTernary();
    const t = this.cur();
    if (t.type === 'OP' && ASSIGN_OPS.has(t.value)) {
      if (!this.isAssignable(left)) this.error('cannot assign to this expression');
      this.advance();
      this.skipNL();
      const value = this.parseAssign(); // right-associative
      if (t.value === '=') return N('Assign', { target: left, value });
      return N('OpAssign', { target: left, op: t.value.slice(0, -1), value });
    }
    return left;
  }

  isAssignable(node) {
    return ['Ident', 'IVar', 'CVar', 'GVar', 'Const', 'Index', 'Self'].includes(node.type) ||
      (node.type === 'Call' && node.receiver && node.args.length === 0 && !node.block);
  }

  parseTernary() {
    const cond = this.parseRange();
    if (this.atOp('?')) {
      this.advance(); this.skipNL();
      const then = this.parseTernary();
      this.skipNL();
      this.expectOp(':');
      this.skipNL();
      const els = this.parseTernary();
      return N('Ternary', { cond, then, else: els });
    }
    return cond;
  }

  parseRange() {
    let left = this.parseBinary(0);
    if (this.atOp('..') || this.atOp('...')) {
      const exclusive = this.cur().value === '...';
      this.advance();
      // endless range: `1..` with nothing after
      let right = null;
      if (!this.rangeEnds()) right = this.parseBinary(0);
      return N('Range', { from: left, to: right, exclusive });
    }
    return left;
  }
  rangeEnds() {
    return this.atType('NEWLINE') || this.atOp(')') || this.atOp(']') ||
      this.atOp(',') || this.atEOF() || this.atOp(';');
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    while (true) {
      const t = this.cur();
      if (t.type !== 'OP' || !(t.value in BINPREC)) break;
      const prec = BINPREC[t.value];
      if (prec < minPrec) break;
      this.advance();
      this.skipNL();
      const right = this.parseBinary(prec + 1);
      if (t.value === '&&' || t.value === '||') {
        left = N('Logical', { op: t.value, left, right });
      } else {
        left = N('BinOp', { op: t.value, left, right });
      }
    }
    return left;
  }

  parseUnary() {
    const t = this.cur();
    if (t.type === 'OP' && (t.value === '-' || t.value === '+' || t.value === '!' || t.value === '~')) {
      this.advance();
      return N('UnaryOp', { op: t.value, operand: this.parseUnary() });
    }
    if (this.atKw('defined?')) {
      this.advance();
      let hasParen = this.atOp('(');
      if (hasParen) this.advance();
      const operand = this.parseExpression();
      if (hasParen) this.expectOp(')');
      return N('Defined', { operand });
    }
    return this.parsePow();
  }

  parsePow() {
    const left = this.parsePostfix();
    if (this.atOp('**')) {
      this.advance(); this.skipNL();
      const right = this.parseUnary(); // right-assoc, allows -exp
      return N('BinOp', { op: '**', left, right });
    }
    return left;
  }

  // ---- postfix: method chains, indexing, calls, blocks --------------------
  parsePostfix() {
    let node = this.parsePrimary();
    while (true) {
      // leading-dot continuation: `foo\n  .bar`
      if (this.atType('NEWLINE')) {
        let j = this.i;
        while (this.toks[j] && this.toks[j].type === 'NEWLINE') j++;
        const t = this.toks[j];
        if (t && t.type === 'OP' && (t.value === '.' || t.value === '&.')) {
          this.i = j;
        } else {
          break;
        }
      }
      if (this.atOp('.') || this.atOp('&.')) {
        const safe = this.cur().value === '&.';
        this.advance();
        this.skipNL();
        // `proc.(args)` is sugar for `proc.call(args)`
        if (this.atOp('(')) { node = this.parseCallTail(node, 'call', safe); continue; }
        const name = this.parseMethodName();
        node = this.parseCallTail(node, name, safe);
      } else if (this.atOp('::')) {
        this.advance();
        if (this.atType('CONST') && !(this.peek().type === 'OP' && this.peek().value === '(')) {
          const name = this.advance().value;
          node = N('ConstPath', { base: node, name });
        } else {
          const name = this.parseMethodName();
          node = this.parseCallTail(node, name, false);
        }
      } else if (this.atOp('[') && !this.cur().spaceBefore) {
        this.advance();
        const args = this.parseArgList(']');
        node = N('Index', { receiver: node, args });
      } else {
        break;
      }
    }
    return node;
  }

  parseMethodName() {
    const t = this.cur();
    if (t.type === 'IDENT' || t.type === 'CONST') { this.advance(); return t.value; }
    if (t.type === 'KEYWORD') { this.advance(); return t.value; }
    // operator method names: +, -, [], == etc.
    if (t.type === 'OP') {
      this.advance();
      if (t.value === '[' ) { this.expectOp(']'); if (this.atOp('=')) { this.advance(); return '[]='; } return '[]'; }
      return t.value;
    }
    this.error('expected method name');
  }

  // After `recv.name`, parse optional (args), command args, and/or a block.
  parseCallTail(receiver, name, safe) {
    let args = [];
    let block = null;
    let blockArg = null;
    if (this.atOp('(') && !this.cur().spaceBefore) {
      this.advance();
      const parsed = this.parseArgListFull(')');
      args = parsed.args; blockArg = parsed.blockArg;
    } else if (this.commandArgsFollow()) {
      const parsed = this.parseCommandArgs();
      args = parsed.args; blockArg = parsed.blockArg;
    }
    block = this.parseOptionalBlock();
    return N('Call', { receiver, name, args, block, blockArg, safe });
  }

  // Does an argument list (without parens) start here?
  commandArgsFollow() {
    const t = this.cur();
    if (t.type === 'NEWLINE' || t.type === 'EOF') return false;
    if (!t.spaceBefore) return false;
    if (ARG_START_TYPES.has(t.type)) return true;
    if (t.type === 'STRING') return true;
    if (t.type === 'KEYWORD') {
      return ['nil', 'true', 'false', 'self', 'lambda', 'not', 'defined?',
        '__method__', 'case', 'begin', 'super', 'yield'].includes(t.value);
    }
    if (t.type === 'OP') {
      // `foo -1` / `foo *x` / `foo &blk` / `foo :sym` / `foo [1]` / `foo ->{}`
      const next = this.peek();
      if (['-', '+', '*', '**', '&', '::'].includes(t.value)) {
        return next && !next.spaceBefore; // unary use: no space after the sign
      }
      if (t.value === '[') return true;
      if (t.value === '(') return true; // `puts (expr)` => puts((expr))
      if (t.value === '->') return true;
      if (t.value === '!' || t.value === '~') return true;
    }
    return false;
  }

  parseCommandArgs() {
    const args = [];
    let blockArg = null;
    const hashPairs = [];
    while (true) {
      const r = this.parseOneArg(hashPairs);
      if (r && r.blockArg) blockArg = r.blockArg;
      else if (r && r.arg) args.push(r.arg);
      if (this.atOp(',')) { this.advance(); this.skipNL(); continue; }
      break;
    }
    if (hashPairs.length) args.push(N('HashLit', { pairs: hashPairs }));
    return { args, blockArg };
  }

  // ---- arguments ----------------------------------------------------------
  // Simple arg list that returns just the nodes (used for indexing []).
  parseArgList(closing) {
    return this.parseArgListFull(closing).args;
  }

  parseArgListFull(closing) {
    const args = [];
    let blockArg = null;
    const hashPairs = [];
    this.skipNL();
    while (!this.atOp(closing)) {
      const r = this.parseOneArg(hashPairs);
      if (r && r.blockArg) blockArg = r.blockArg;
      else if (r && r.arg) args.push(r.arg);
      this.skipNL();
      if (this.atOp(',')) { this.advance(); this.skipNL(); }
      else break;
    }
    this.skipNL();
    this.expectOp(closing);
    if (hashPairs.length) args.push(N('HashLit', { pairs: hashPairs }));
    return { args, blockArg };
  }

  parseOneArg(hashPairs) {
    if (this.atOp('&')) { this.advance(); return { blockArg: this.parseTernary() }; }
    if (this.atOp('*')) { this.advance(); return { arg: N('Splat', { value: this.parseTernary() }) }; }
    if (this.atOp('**')) { this.advance(); return { arg: N('DoubleSplat', { value: this.parseTernary() }) }; }
    if (this.atType('LABEL')) {
      const key = this.advance().value;
      this.skipNL();
      const value = this.parseTernary();
      hashPairs.push({ key: N('SymLit', { name: key }), value });
      return null;
    }
    const e = this.parseTernary();
    if (this.atOp('=>')) {
      this.advance(); this.skipNL();
      const value = this.parseTernary();
      hashPairs.push({ key: e, value });
      return null;
    }
    return { arg: e };
  }

  parseOptionalBlock() {
    if (this.atOp('{')) {
      this.advance();
      const params = this.parseBlockParams();
      const body = this.parseStatements(() => this.atOp('}'));
      this.expectOp('}');
      return N('BlockNode', { params, body });
    }
    if (this.atKw('do')) {
      this.advance();
      this.skipNL();
      const params = this.parseBlockParams();
      const body = this.parseStatements(() => this.atKw('end'));
      this.expectKw('end');
      return N('BlockNode', { params, body });
    }
    return null;
  }

  parseBlockParams() {
    this.skipNL();
    if (!this.atOp('|')) return [];
    this.advance();
    const params = this.parseParamList(() => this.atOp('|'));
    this.expectOp('|');
    return params;
  }

  parseParamList(stop) {
    const params = [];
    this.skipNL();
    while (!stop() && !this.atOp(')')) {
      if (this.atOp('*')) {
        this.advance();
        const name = this.atType('IDENT') ? this.advance().value : null;
        params.push({ kind: 'rest', name });
      } else if (this.atOp('**')) {
        this.advance();
        const name = this.atType('IDENT') ? this.advance().value : null;
        params.push({ kind: 'kwrest', name });
      } else if (this.atOp('&')) {
        this.advance();
        const name = this.advance().value;
        params.push({ kind: 'block', name });
      } else if (this.atType('LABEL')) {
        const name = this.advance().value;
        let def = null;
        if (!this.atOp(',') && !stop() && !this.atType('NEWLINE')) def = this.parseTernary();
        params.push({ kind: 'key', name, default: def });
      } else if (this.atType('IDENT')) {
        const name = this.advance().value;
        if (this.atOp('=')) {
          this.advance();
          const def = this.parseTernary();
          params.push({ kind: 'opt', name, default: def });
        } else {
          params.push({ kind: 'req', name });
        }
      } else if (this.atOp('(')) {
        // nested destructuring (a, b)
        this.advance();
        const sub = this.parseParamList(() => this.atOp(')'));
        this.expectOp(')');
        params.push({ kind: 'destructure', names: sub });
      } else break;
      this.skipNL();
      if (this.atOp(',')) { this.advance(); this.skipNL(); }
      else break;
    }
    return params;
  }

  // ---- primary ------------------------------------------------------------
  parsePrimary() {
    const t = this.cur();
    switch (t.type) {
      case 'INT': this.advance(); return N('IntLit', { value: t.value });
      case 'FLOAT': this.advance(); return N('FloatLit', { value: t.value });
      case 'STRING': this.advance(); return this.makeString(t.value);
      case 'SYMBOL': this.advance(); return N('SymLit', { name: t.value });
      case 'REGEX': {
        this.advance();
        const parts = t.value.parts.map((p) =>
          'str' in p ? { str: p.str } : { node: parseExpression(p.expr) });
        return N('RegexLit', { parts, flags: t.value.flags });
      }
      case 'WORDS': {
        this.advance();
        const elements = t.value.words.map((w) =>
          t.value.kind === 'i'
            ? N('SymLit', { name: w })
            : N('StrLit', { parts: [{ str: w }] }));
        return N('ArrayLit', { elements });
      }
      case 'IVAR': this.advance(); return N('IVar', { name: t.value });
      case 'CVAR': this.advance(); return N('CVar', { name: t.value });
      case 'GVAR': this.advance(); return N('GVar', { name: t.value });
      case 'CONST': return this.parseConstOrCall();
      case 'IDENT': return this.parseIdentifier();
      case 'LABEL': {
        // a bare `key:` at expression start begins a hash in some contexts;
        // treat as symbol key — fall through by re-emitting as hash pair is
        // handled by callers; here just produce a symbol for safety.
        this.advance();
        return N('SymLit', { name: t.value });
      }
      case 'KEYWORD': return this.parseKeyword();
      case 'OP': return this.parseOpPrimary();
      default:
        this.error('unexpected token');
    }
  }

  makeString(parts) {
    const out = parts.map((p) => {
      if ('str' in p) return { str: p.str };
      const sub = parseExpression(p.expr);
      return { node: sub };
    });
    return N('StrLit', { parts: out });
  }

  parseConstOrCall() {
    const t = this.advance();
    // Const may be a method call: Foo(...) is rare; Foo.new common via postfix.
    if (this.atOp('(') && !this.cur().spaceBefore) {
      return this.parseCallTail(null, t.value, false);
    }
    if (this.commandArgsFollow()) {
      return this.parseCallTail(null, t.value, false);
    }
    return N('Const', { name: t.value });
  }

  parseIdentifier() {
    const t = this.advance();
    const name = t.value;
    if (this.atOp('(') && !this.cur().spaceBefore) {
      return this.parseCallTail(null, name, false);
    }
    if (this.commandArgsFollow()) {
      return this.parseCallTail(null, name, false);
    }
    // bare identifier: could be a local var or a zero-arg method; also may
    // take a block: `foo { }`
    const block = this.parseOptionalBlock();
    if (block) return N('Call', { receiver: null, name, args: [], block, blockArg: null, safe: false });
    return N('Ident', { name });
  }

  parseOpPrimary() {
    const t = this.cur();
    if (t.value === '(') {
      this.advance(); this.skipNL();
      const expr = this.parseStatementInParens();
      this.skipNL();
      this.expectOp(')');
      return expr;
    }
    if (t.value === '[') {
      this.advance();
      const args = this.parseArgList(']');
      return N('ArrayLit', { elements: args });
    }
    if (t.value === '{') {
      this.advance();
      const pairs = this.parseHashBody();
      this.expectOp('}');
      return N('HashLit', { pairs });
    }
    if (t.value === '->') {
      return this.parseStabbyLambda();
    }
    if (t.value === '::') {
      // top-level constant ::Foo
      this.advance();
      const name = this.expectType('CONST').value;
      return N('Const', { name, topLevel: true });
    }
    if (t.value === '*') { this.advance(); return N('Splat', { value: this.parseUnary() }); }
    if (t.value === '&') { this.advance(); return N('BlockPass', { value: this.parseUnary() }); }
    this.error('unexpected operator');
  }

  parseStatementInParens() {
    // allow a sequence `(a; b)` -> last value; commonly just one expr
    let node = this.parseStatement();
    while (this.atOp(';') || this.atType('NEWLINE')) {
      this.skipTerminators();
      if (this.atOp(')')) break;
      node = this.parseStatement();
    }
    return node;
  }

  parseHashBody() {
    const pairs = [];
    this.skipNL();
    while (!this.atOp('}')) {
      if (this.atOp('**')) {
        this.advance();
        pairs.push({ doubleSplat: this.parseTernary() });
      } else if (this.atType('LABEL')) {
        const key = this.advance().value;
        this.skipNL();
        const value = this.parseTernary();
        pairs.push({ key: N('SymLit', { name: key }), value });
      } else {
        const key = this.parseTernary();
        this.skipNL();
        this.expectOp('=>');
        this.skipNL();
        const value = this.parseTernary();
        pairs.push({ key, value });
      }
      this.skipNL();
      if (this.atOp(',')) { this.advance(); this.skipNL(); }
      else break;
    }
    this.skipNL();
    return pairs;
  }

  parseStabbyLambda() {
    this.expectOp('->');
    let params = [];
    if (this.atOp('(')) {
      this.advance();
      params = this.parseParamList(() => this.atOp(')'));
      this.expectOp(')');
    }
    let body;
    if (this.atOp('{')) {
      this.advance();
      body = this.parseStatements(() => this.atOp('}'));
      this.expectOp('}');
    } else {
      this.expectKw('do');
      this.skipNL();
      body = this.parseStatements(() => this.atKw('end'));
      this.expectKw('end');
    }
    return N('Lambda', { params, body });
  }

  // ---- keyword forms ------------------------------------------------------
  parseKeyword() {
    const v = this.cur().value;
    switch (v) {
      case 'nil': this.advance(); return N('NilLit', {});
      case 'true': this.advance(); return N('BoolLit', { value: true });
      case 'false': this.advance(); return N('BoolLit', { value: false });
      case 'self': this.advance(); return N('Self', {});
      case '__method__': this.advance(); return N('MethodName', {});
      case 'if': return this.parseIf(false);
      case 'unless': return this.parseIf(true);
      case 'while': return this.parseWhile(false);
      case 'until': return this.parseWhile(true);
      case 'for': return this.parseFor();
      case 'case': return this.parseCase();
      case 'def': return this.parseDef();
      case 'class': return this.parseClass();
      case 'module': return this.parseModule();
      case 'begin': return this.parseBegin();
      case 'return': return this.parseJump('Return');
      case 'break': return this.parseJump('Break');
      case 'next': return this.parseJump('Next');
      case 'redo': this.advance(); return N('Redo', {});
      case 'retry': this.advance(); return N('Retry', {});
      case 'yield': return this.parseYield();
      case 'super': return this.parseSuper();
      case 'not': this.advance(); return N('Not', { operand: this.parseExpression() });
      case 'attr_accessor':
      case 'attr_reader':
      case 'attr_writer':
        return this.parseAttr(v);
      case 'lambda': {
        this.advance();
        const block = this.parseOptionalBlock();
        return N('Call', { receiver: null, name: 'lambda', args: [], block, blockArg: null, safe: false });
      }
      default:
        this.error(`unexpected keyword '${v}'`);
    }
  }

  parseAttr(kind) {
    this.advance();
    const names = [];
    const collect = () => {
      if (this.atType('SYMBOL')) names.push(this.advance().value);
      else if (this.atType('STRING')) names.push(this.advance().value.map(p => p.str || '').join(''));
      else this.error('attr expects symbols');
    };
    if (this.atOp('(')) {
      this.advance();
      this.skipNL();
      collect();
      while (this.atOp(',')) { this.advance(); this.skipNL(); collect(); }
      this.skipNL();
      this.expectOp(')');
    } else {
      collect();
      while (this.atOp(',')) { this.advance(); this.skipNL(); collect(); }
    }
    return N('Attr', { kind, names });
  }

  parseIf(isUnless) {
    this.advance(); // if/unless
    let cond = this.parseExpression();
    if (isUnless) cond = N('Not', { operand: cond });
    this.acceptThen();
    const then = this.parseStatements(() =>
      this.atKw('elsif') || this.atKw('else') || this.atKw('end'));
    const elifs = [];
    let elseBody = null;
    while (this.atKw('elsif')) {
      this.advance();
      const c = this.parseExpression();
      this.acceptThen();
      const b = this.parseStatements(() =>
        this.atKw('elsif') || this.atKw('else') || this.atKw('end'));
      elifs.push({ cond: c, body: b });
    }
    if (this.atKw('else')) {
      this.advance();
      elseBody = this.parseStatements(() => this.atKw('end'));
    }
    this.expectKw('end');
    return N('If', { cond, then, elifs, elseBody });
  }

  acceptThen() {
    this.skipTerminators();
    if (this.atKw('then')) { this.advance(); this.skipTerminators(); }
  }
  acceptDo() {
    this.skipTerminators();
    if (this.atKw('do')) { this.advance(); this.skipTerminators(); }
  }

  parseWhile(isUntil) {
    this.advance();
    const cond = this.parseExpression();
    this.acceptDo();
    const body = this.parseStatements(() => this.atKw('end'));
    this.expectKw('end');
    return N('While', { cond, body, isUntil, doWhile: false });
  }

  parseFor() {
    this.advance();
    const vars = [this.advance().value];
    while (this.atOp(',')) { this.advance(); vars.push(this.advance().value); }
    this.expectKw('in');
    const iter = this.parseExpression();
    this.acceptDo();
    const body = this.parseStatements(() => this.atKw('end'));
    this.expectKw('end');
    return N('For', { vars, iter, body });
  }

  parseCase() {
    this.advance();
    let subject = null;
    if (!this.atType('NEWLINE') && !this.atKw('when')) subject = this.parseExpression();
    this.skipTerminators();
    const whens = [];
    while (this.atKw('when')) {
      this.advance();
      const conds = [this.parseWhenCond()];
      while (this.atOp(',')) { this.advance(); this.skipNL(); conds.push(this.parseWhenCond()); }
      this.acceptThen();
      const body = this.parseStatements(() =>
        this.atKw('when') || this.atKw('else') || this.atKw('end'));
      whens.push({ conds, body });
    }
    let elseBody = null;
    if (this.atKw('else')) {
      this.advance();
      elseBody = this.parseStatements(() => this.atKw('end'));
    }
    this.expectKw('end');
    return N('Case', { subject, whens, elseBody });
  }

  parseWhenCond() {
    if (this.atOp('*')) { this.advance(); return N('Splat', { value: this.parseTernary() }); }
    return this.parseTernary();
  }

  parseDef() {
    this.advance();
    let singleton = null;
    // def self.name / def Foo.name
    if ((this.atKw('self') || this.atType('CONST') || this.atType('IDENT')) &&
        this.peek().type === 'OP' && this.peek().value === '.') {
      if (this.atKw('self')) { this.advance(); singleton = N('Self', {}); }
      else { const tk = this.advance(); singleton = tk.type === 'CONST' ? N('Const', { name: tk.value }) : N('Ident', { name: tk.value }); }
      this.expectOp('.');
    }
    const name = this.parseDefName();
    let params = [];
    if (this.atOp('(') && !this.cur().spaceBefore) {
      this.advance();
      params = this.parseParamList(() => this.atOp(')'));
      this.expectOp(')');
    } else if (!this.atType('NEWLINE') && !this.atOp('=') && !this.atOp(';')) {
      // paren-less params: def foo a, b
      params = this.parseParamList(() => this.atType('NEWLINE') || this.atOp('='));
    }
    // endless method: def foo = expr
    if (this.atOp('=')) {
      this.advance(); this.skipNL();
      const body = [this.parseExpression()];
      return N('Def', { name, params, body, singleton });
    }
    this.skipTerminators();
    const { body, rescues, elseBody, ensureBody } = this.parseBodyWithRescue(() => this.atKw('end'));
    this.expectKw('end');
    let b = body;
    if (rescues.length || ensureBody || elseBody) {
      b = [N('Begin', { body, rescues, elseBody, ensureBody })];
    }
    return N('Def', { name, params, body: b, singleton });
  }

  parseDefName() {
    const t = this.cur();
    if (t.type === 'IDENT' || t.type === 'CONST') {
      this.advance();
      let name = t.value;
      if (this.atOp('=') && !this.cur().spaceBefore && this.peek().type !== 'OP') {
        // setter def name=(v) — but avoid endless-def `=`; require it to be a setter form
      }
      return name;
    }
    if (t.type === 'KEYWORD') { this.advance(); return t.value; }
    // operator methods
    return this.parseMethodName();
  }

  parseClass() {
    this.advance();
    if (this.atOp('<<')) {
      // class << self  (singleton class) — collect defs as singleton methods
      this.advance();
      const obj = this.parseExpression();
      this.skipTerminators();
      const body = this.parseStatements(() => this.atKw('end'));
      this.expectKw('end');
      return N('SingletonClass', { obj, body });
    }
    let name = this.expectType('CONST').value;
    const path = [name];
    while (this.atOp('::')) { this.advance(); path.push(this.expectType('CONST').value); }
    let superclass = null;
    if (this.atOp('<')) { this.advance(); superclass = this.parseExpression(); }
    this.skipTerminators();
    const body = this.parseStatements(() => this.atKw('end'));
    this.expectKw('end');
    return N('Class', { name: path.join('::'), path, superclass, body });
  }

  parseModule() {
    this.advance();
    const name = this.expectType('CONST').value;
    this.skipTerminators();
    const body = this.parseStatements(() => this.atKw('end'));
    this.expectKw('end');
    return N('Module', { name, body });
  }

  parseBegin() {
    this.advance();
    this.skipTerminators();
    const { body, rescues, elseBody, ensureBody } = this.parseBodyWithRescue(() => this.atKw('end'));
    this.expectKw('end');
    return N('Begin', { body, rescues, elseBody, ensureBody });
  }

  parseBodyWithRescue(stop) {
    const body = this.parseStatements(() =>
      stop() || this.atKw('rescue') || this.atKw('ensure') || this.atKw('else'));
    const rescues = [];
    let elseBody = null;
    let ensureBody = null;
    while (this.atKw('rescue')) {
      this.advance();
      const classes = [];
      let varName = null;
      if (!this.atType('NEWLINE') && !this.atOp('=>') && !this.atKw('then')) {
        classes.push(this.parseExpression());
        while (this.atOp(',')) { this.advance(); classes.push(this.parseExpression()); }
      }
      if (this.atOp('=>')) { this.advance(); varName = this.advance().value; }
      this.acceptThen();
      const rbody = this.parseStatements(() =>
        stop() || this.atKw('rescue') || this.atKw('ensure') || this.atKw('else'));
      rescues.push({ classes, varName, body: rbody });
    }
    if (this.atKw('else')) {
      this.advance();
      elseBody = this.parseStatements(() => stop() || this.atKw('ensure'));
    }
    if (this.atKw('ensure')) {
      this.advance();
      ensureBody = this.parseStatements(stop);
    }
    return { body, rescues, elseBody, ensureBody };
  }

  parseJump(type) {
    this.advance();
    let value = null;
    if (!this.atType('NEWLINE') && !this.atOp(';') && !this.atEOF() &&
        !this.atKw('end') && !this.atKw('if') && !this.atKw('unless') &&
        !this.atOp('}')) {
      value = this.parseExpression();
      // multiple return values -> array
      if (this.atOp(',')) {
        const elements = [value];
        while (this.atOp(',')) { this.advance(); elements.push(this.parseExpression()); }
        value = N('ArrayLit', { elements });
      }
    }
    return N(type, { value });
  }

  parseYield() {
    this.advance();
    let args = [];
    if (this.atOp('(') && !this.cur().spaceBefore) {
      this.advance();
      args = this.parseArgList(')');
    } else if (this.commandArgsFollow()) {
      args = this.parseCommandArgs().args;
    }
    return N('Yield', { args });
  }

  parseSuper() {
    this.advance();
    let args = null; // null => zsuper (forward args)
    if (this.atOp('(') && !this.cur().spaceBefore) {
      this.advance();
      args = this.parseArgList(')');
    } else if (this.commandArgsFollow()) {
      args = this.parseCommandArgs().args;
    }
    const block = this.parseOptionalBlock();
    return N('Super', { args, block });
  }
}

export function parse(source) {
  const tokens = tokenize(source);
  return new Parser(tokens).parseProgram();
}

// Parse a standalone expression (used for string interpolation segments).
export function parseExpression(source) {
  const tokens = tokenize(source);
  const p = new Parser(tokens);
  p.skipTerminators();
  const expr = p.parseStatement();
  return expr;
}
