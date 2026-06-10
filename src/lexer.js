// Lexer: turns Ruby source text into a flat list of tokens.
// Newlines are significant (statement separators), so we emit NEWLINE tokens
// except where a line clearly continues (after operators, commas, open parens…).

const KEYWORDS = new Set([
  'def', 'end', 'if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'in',
  'do', 'class', 'module', 'return', 'yield', 'begin', 'rescue', 'ensure',
  'then', 'case', 'when', 'break', 'next', 'redo', 'retry', 'nil', 'true',
  'false', 'self', 'and', 'or', 'not', 'super', 'defined?', '__method__',
  'attr_accessor', 'attr_reader', 'attr_writer', 'alias',
]);

// Multi-character operators, longest first so we match greedily.
const OPERATORS = [
  '**=', '<=>', '===', '...', '||=', '&&=', '<<=', '>>=', '**',
  '==', '!=', '>=', '<=', '&&', '||', '<<', '>>', '+=', '-=', '*=', '/=',
  '%=', '|=', '&=', '^=', '..', '=>', '->', '::', '=~', '&.',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':',
  '.', ',', '(', ')', '[', ']', '{', '}', ';',
];

function isIdentStart(c) {
  return c !== undefined && /[A-Za-z_]/.test(c);
}
function isIdentPart(c) {
  return c !== undefined && /[A-Za-z0-9_]/.test(c);
}
function isDigit(c) {
  return c !== undefined && c >= '0' && c <= '9';
}

export class Lexer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
    this.line = 1;
    this.tokens = [];
    this.spaceBefore = false; // whitespace immediately precedes the next token
    this.pendingHeredocs = []; // heredoc bodies read when the line's newline is hit
  }

  error(msg) {
    throw new SyntaxError(`Lex error (line ${this.line}): ${msg}`);
  }

  peek(o = 0) {
    return this.src[this.pos + o];
  }

  push(type, value) {
    this.tokens.push({ type, value, line: this.line, spaceBefore: this.spaceBefore });
    this.spaceBefore = false;
  }

  // Was the previous meaningful token something a value can follow?
  // Used to disambiguate `-` (unary vs binary), `[`, `/`, `%`, `:` etc.
  prevAllowsValue() {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i];
      if (t.type === 'NEWLINE') continue;
      // closing brackets end a value -> a following / % << is a binary operator
      if (t.type === 'OP' && (t.value === ')' || t.value === ']' || t.value === '}')) return false;
      // after these, a new value/expression begins
      if (t.type === 'OP') return true;
      if (t.type === 'KEYWORD' && t.value !== 'end' && t.value !== 'self' &&
          t.value !== 'nil' && t.value !== 'true' && t.value !== 'false') return true;
      return false;
    }
    return true; // start of input
  }

  tokenize() {
    while (this.pos < this.src.length) {
      this.scanToken();
    }
    this.push('NEWLINE', '\n');
    this.push('EOF', null);
    return this.tokens;
  }

  scanToken() {
    const c = this.peek();

    // Spaces and tabs (line continuation handled via backslash).
    if (c === ' ' || c === '\t' || c === '\r') {
      this.pos++;
      this.spaceBefore = true;
      return;
    }

    // Explicit line continuation.
    if (c === '\\' && this.peek(1) === '\n') {
      this.pos += 2;
      this.line++;
      this.spaceBefore = true;
      return;
    }

    // Newline -> statement separator.
    if (c === '\n') {
      this.pos++;
      this.line++;
      this.push('NEWLINE', '\n');
      this.spaceBefore = true;
      if (this.pendingHeredocs.length) this.readHeredocBodies();
      return;
    }

    // Heredoc start: <<~TAG <<-TAG <<TAG <<"TAG" <<'TAG'
    if (c === '<' && this.peek(1) === '<') {
      if (this.tryHeredoc()) return;
    }

    // Comments.
    if (c === '#') {
      while (this.pos < this.src.length && this.peek() !== '\n') this.pos++;
      this.spaceBefore = true;
      return;
    }

    // __END__ marker: everything after is DATA, stop lexing.
    if (c === '_' && this.atLineStart() &&
        (this.src.startsWith('__END__\n', this.pos) || this.src.slice(this.pos) === '__END__')) {
      this.pos = this.src.length;
      return;
    }

    // =begin / =end block comments.
    if (c === '=' && this.atLineStart() && this.src.startsWith('=begin', this.pos)) {
      while (this.pos < this.src.length && !this.src.startsWith('=end', this.pos)) {
        if (this.peek() === '\n') this.line++;
        this.pos++;
      }
      while (this.pos < this.src.length && this.peek() !== '\n') this.pos++;
      return;
    }

    // %w[...] %i[...] word/symbol array literals (and %q/%Q strings).
    if (c === '%' && (this.prevAllowsValue() || this.spaceBefore)) {
      // …but after `def` or `.` a `%` is an operator-method name, not a literal
      let j = this.tokens.length - 1;
      while (j >= 0 && this.tokens[j].type === 'NEWLINE') j--;
      const prev = j >= 0 ? this.tokens[j] : null;
      const isDefName = prev && ((prev.type === 'KEYWORD' && prev.value === 'def') ||
        (prev.type === 'OP' && prev.value === '.'));
      if (!isDefName) {
        const k = this.peek(1);
        if ('wWiI'.includes(k) && this.isDelim(this.peek(2))) return this.scanWords(k);
        if ('qQ'.includes(k) && this.isDelim(this.peek(2))) return this.scanPercentString(k);
        if (k === 'r' && this.isDelim(this.peek(2))) return this.scanPercentRegex();
        if (k === 's' && this.isDelim(this.peek(2))) return this.scanPercentSymbol();
        if (this.isDelim(k)) return this.scanPercentString('Q', 1);
      }
    }

    // Regex literal /pattern/flags (vs division — use value context + spacing).
    if (c === '/' && (this.prevAllowsValue() ||
        (this.spaceBefore && this.peek(1) !== ' ' && this.peek(1) !== '=' && this.peek(1) !== undefined))) {
      // …but after `def` or `.` a slash is an operator-method name
      let j = this.tokens.length - 1;
      while (j >= 0 && this.tokens[j].type === 'NEWLINE') j--;
      const prev = j >= 0 ? this.tokens[j] : null;
      const isDefName = prev && ((prev.type === 'KEYWORD' && prev.value === 'def') ||
        (prev.type === 'OP' && prev.value === '.'));
      if (!isDefName) return this.scanRegex();
    }

    if (isDigit(c)) return this.scanNumber();
    if (c === '"') return this.scanString('"', true);
    if (c === "'") return this.scanString("'", false);
    if (c === '`') return this.scanString('`', true);

    // Instance / class / global variables.
    if (c === '@') {
      if (this.peek(1) === '@') return this.scanVar('CVAR', 2);
      return this.scanVar('IVAR', 1);
    }
    if (c === '$') return this.scanVar('GVAR', 1);

    // Symbol literal :name  (but not :: and not ternary `?:`).
    if (c === ':' && this.peek(1) === ':') {
      // scope resolution operator, handled by operator scan
    } else if (c === ':' && (isIdentStart(this.peek(1)) || this.peek(1) === '"' ||
        this.peek(1) === '@' || this.peek(1) === '$' ||
        '+-*/%<>=!~&|^['.includes(this.peek(1)))) {
      return this.scanSymbol();
    }

    if (isIdentStart(c)) return this.scanIdentifier();

    return this.scanOperator();
  }

  atLineStart() {
    return this.pos === 0 || this.src[this.pos - 1] === '\n';
  }

  scanNumber() {
    // 0x / 0b / 0o radix literals
    if (this.peek() === '0' && this.peek(1) !== undefined && 'xXbBoO'.includes(this.peek(1))) {
      const kind = this.peek(1).toLowerCase();
      const radix = kind === 'x' ? 16 : kind === 'b' ? 2 : 8;
      const re = kind === 'x' ? /[0-9a-fA-F_]/ : kind === 'b' ? /[01_]/ : /[0-7_]/;
      let p = this.pos + 2;
      let digits = '';
      while (p < this.src.length && re.test(this.src[p])) { if (this.src[p] !== '_') digits += this.src[p]; p++; }
      if (digits.length) {
        this.pos = p;
        this.push('INT', parseInt(digits, radix));
        return;
      }
    }
    const start = this.pos;
    let isFloat = false;
    while (isDigit(this.peek()) || this.peek() === '_') this.pos++;
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      isFloat = true;
      this.pos++;
      while (isDigit(this.peek()) || this.peek() === '_') this.pos++;
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      isFloat = true;
      this.pos++;
      if (this.peek() === '+' || this.peek() === '-') this.pos++;
      while (isDigit(this.peek())) this.pos++;
    }
    const text = this.src.slice(start, this.pos).replace(/_/g, '');
    this.push(isFloat ? 'FLOAT' : 'INT', isFloat ? parseFloat(text) : parseInt(text, 10));
  }

  scanVar(type, prefixLen) {
    const start = this.pos;
    this.pos += prefixLen;
    // Special global variables like $!, $~, $0
    if (type === 'GVAR' && !isIdentStart(this.peek())) {
      this.pos++; // consume one punctuation char
      this.push(type, this.src.slice(start, this.pos));
      return;
    }
    while (isIdentPart(this.peek())) this.pos++;
    this.push(type, this.src.slice(start, this.pos));
  }

  scanSymbol() {
    this.pos++; // consume ':'
    if (this.peek() === '"') {
      // :"interpolated-ish" — treat as plain string symbol (no interpolation).
      this.pos++;
      let val = '';
      while (this.pos < this.src.length && this.peek() !== '"') {
        val += this.peek();
        this.pos++;
      }
      this.pos++;
      this.push('SYMBOL', val);
      return;
    }
    // :@ivar / :@@cvar / :$gvar symbols
    if (this.peek() === '@' || this.peek() === '$') {
      const start = this.pos;
      this.pos++;
      if (this.peek() === '@') this.pos++;
      while (isIdentPart(this.peek())) this.pos++;
      this.push('SYMBOL', this.src.slice(start, this.pos));
      return;
    }
    // operator-method symbols like :+ :== :<=> :[] :[]=
    if (!isIdentStart(this.peek())) {
      const ops = ['<=>', '===', '==', '!=', '<=', '>=', '<<', '>>', '[]=', '[]',
        '**', '+@', '-@', '+', '-', '*', '/', '%', '<', '>', '&', '|', '^', '~', '!', '=~'];
      for (const op of ops) {
        if (this.src.startsWith(op, this.pos)) { this.pos += op.length; this.push('SYMBOL', op); return; }
      }
    }
    const start = this.pos;
    while (isIdentPart(this.peek())) this.pos++;
    if (this.peek() === '?' || this.peek() === '!' || this.peek() === '=') this.pos++;
    this.push('SYMBOL', this.src.slice(start, this.pos));
  }

  scanIdentifier() {
    const start = this.pos;
    while (isIdentPart(this.peek())) this.pos++;
    // method-name suffixes
    if (this.peek() === '?' || this.peek() === '!') {
      // don't grab `!=` etc; only when followed by non-`=` or it's the name end
      if (!(this.peek() === '!' && this.peek(1) === '=')) this.pos++;
    }
    let text = this.src.slice(start, this.pos);

    if (text === 'defined' && this.peek() === '?') {
      this.pos++;
      text = 'defined?';
    }

    // `foo:` keyword-argument / hash-shorthand label.
    if (this.peek() === ':' && this.peek(1) !== ':' &&
        KEYWORDS.has(text) === false) {
      // Look like a label only when used as `key:` (followed by space/value).
      // We emit LABEL and consume the colon.
      this.pos++;
      this.push('LABEL', text);
      return;
    }

    if (KEYWORDS.has(text)) {
      this.push('KEYWORD', text);
    } else if (/^[A-Z]/.test(text)) {
      this.push('CONST', text);
    } else {
      this.push('IDENT', text);
    }
  }

  scanString(quote, interpolate) {
    this.pos++; // consume opening quote
    const parts = [];
    let buf = '';
    while (this.pos < this.src.length && this.peek() !== quote) {
      const c = this.peek();
      if (c === '\\') {
        const n = this.peek(1);
        if (interpolate) {
          buf += this.scanEscape();
        } else {
          // single-quoted: only \\ and \' are special
          if (n === '\\' || n === quote) {
            buf += n;
            this.pos += 2;
          } else {
            buf += c;
            this.pos++;
          }
        }
        continue;
      }
      if (interpolate && c === '#' && this.peek(1) === '{') {
        if (buf.length) {
          parts.push({ str: buf });
          buf = '';
        }
        this.pos += 2;
        const expr = this.scanInterpolation();
        parts.push({ expr });
        continue;
      }
      if (c === '\n') this.line++;
      buf += c;
      this.pos++;
    }
    if (this.peek() !== quote) this.error('unterminated string literal');
    this.pos++; // consume closing quote
    if (buf.length || parts.length === 0) parts.push({ str: buf });
    this.push('STRING', parts);
  }

  // Consume a backslash escape starting at this.pos (which points at `\`),
  // advancing past it; returns the decoded characters. Handles multi-char
  // forms: \xNN, \uXXXX, \u{...}, and octal \NNN.
  scanEscape() {
    const n = this.peek(1);
    if (n === 'x') {
      let hex = '';
      let i = 2;
      while (hex.length < 2 && /[0-9a-fA-F]/.test(this.peek(i) ?? '')) { hex += this.peek(i); i++; }
      if (hex.length) { this.pos += i; return String.fromCharCode(parseInt(hex, 16)); }
      this.pos += 2; return 'x';
    }
    if (n === 'u') {
      if (this.peek(2) === '{') {
        let j = 3; let out = ''; let cur = '';
        while (this.peek(j) !== undefined && this.peek(j) !== '}') {
          const ch = this.peek(j);
          if (ch === ' ') { if (cur) { out += String.fromCodePoint(parseInt(cur, 16)); cur = ''; } }
          else cur += ch;
          j++;
        }
        if (cur) out += String.fromCodePoint(parseInt(cur, 16));
        this.pos += j + 1;
        return out;
      }
      let hex = '';
      let i = 2;
      while (hex.length < 4 && /[0-9a-fA-F]/.test(this.peek(i) ?? '')) { hex += this.peek(i); i++; }
      if (hex.length === 4) { this.pos += i; return String.fromCodePoint(parseInt(hex, 16)); }
      this.pos += 2; return 'u';
    }
    if (n >= '0' && n <= '7') {
      let oct = '';
      let i = 1;
      while (oct.length < 3 && (this.peek(i) ?? '') >= '0' && (this.peek(i) ?? '') <= '7') { oct += this.peek(i); i++; }
      this.pos += i;
      return String.fromCharCode(parseInt(oct, 8));
    }
    this.pos += 2;
    return this.unescape(n);
  }

  unescape(n) {
    switch (n) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 's': return ' ';
      case '0': return '\0';
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case 'e': return '\x1b';
      case '"': return '"';
      case "'": return "'";
      case '\\': return '\\';
      case '#': return '#';
      default: return n;
    }
  }

  // Read source inside #{ ... } balancing braces; return the raw Ruby source.
  scanInterpolation() {
    let depth = 1;
    let out = '';
    while (this.pos < this.src.length && depth > 0) {
      const c = this.peek();
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { this.pos++; break; }
      } else if (c === '"' || c === "'") {
        // skip nested string so its braces don't confuse us
        out += c;
        this.pos++;
        const q = c;
        while (this.pos < this.src.length && this.peek() !== q) {
          if (this.peek() === '\\') { out += this.peek(); this.pos++; }
          out += this.peek();
          this.pos++;
        }
        out += this.peek();
        this.pos++;
        continue;
      } else if (c === '\n') {
        this.line++;
      }
      out += c;
      this.pos++;
    }
    return out;
  }

  scanRegex() {
    this.pos++; // consume opening /
    const parts = [];
    let buf = '';
    let inClass = false;
    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c === '\\') { buf += c + (this.peek(1) ?? ''); this.pos += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      if (c === '#' && this.peek(1) === '{') {
        if (buf.length) { parts.push({ str: buf }); buf = ''; }
        this.pos += 2;
        parts.push({ expr: this.scanInterpolation() });
        continue;
      }
      if (c === '\n') this.line++;
      buf += c; this.pos++;
    }
    this.pos++; // consume closing /
    let flags = '';
    while (this.peek() !== undefined && /[imxouesn]/.test(this.peek())) { flags += this.peek(); this.pos++; }
    if (buf.length || parts.length === 0) parts.push({ str: buf });
    this.push('REGEX', { parts, flags });
  }

  tryHeredoc() {
    let p = this.pos + 2;
    let squiggly = false, dashed = false;
    if (this.src[p] === '~') { squiggly = true; p++; }
    else if (this.src[p] === '-') { dashed = true; p++; }
    let interpolate = true;
    let tag = '';
    const ch = this.src[p];
    if (ch === '"' || ch === "'" || ch === '`') {
      interpolate = ch !== "'";
      p++;
      while (p < this.src.length && this.src[p] !== ch) { tag += this.src[p]; p++; }
      p++;
    } else if (ch !== undefined && /[A-Za-z_]/.test(ch)) {
      // bareword tag: require uppercase/underscore start to avoid clashing with `<<` shift
      if (!squiggly && !dashed && !/[A-Z_]/.test(ch)) return false;
      while (p < this.src.length && /[A-Za-z0-9_]/.test(this.src[p])) { tag += this.src[p]; p++; }
    } else {
      return false;
    }
    if (!tag) return false;
    if (!(this.prevAllowsValue() || this.spaceBefore)) return false;

    this.pos = p;
    const token = { type: 'STRING', value: [{ str: '' }], line: this.line, spaceBefore: this.spaceBefore };
    this.tokens.push(token);
    this.spaceBefore = false;
    this.pendingHeredocs.push({ token, tag, squiggly, dashed, interpolate });
    return true;
  }

  readHeredocBodies() {
    for (const h of this.pendingHeredocs) {
      const lines = [];
      while (this.pos < this.src.length) {
        const start = this.pos;
        while (this.pos < this.src.length && this.peek() !== '\n') this.pos++;
        const lineText = this.src.slice(start, this.pos);
        if (this.pos < this.src.length) { this.pos++; this.line++; }
        const matches = (h.squiggly || h.dashed) ? lineText.trim() === h.tag : lineText === h.tag;
        if (matches) break;
        lines.push(lineText);
      }
      let content;
      if (h.squiggly) {
        const indents = lines.filter((l) => l.trim().length).map((l) => l.match(/^[ \t]*/)[0].length);
        const min = indents.length ? Math.min(...indents) : 0;
        content = lines.map((l) => l.slice(min)).join('\n');
      } else {
        content = lines.join('\n');
      }
      if (lines.length) content += '\n';
      h.token.value = h.interpolate ? this.heredocParts(content) : [{ str: content }];
    }
    this.pendingHeredocs = [];
  }

  heredocParts(content) {
    const parts = [];
    let buf = '';
    let i = 0;
    while (i < content.length) {
      const c = content[i];
      if (c === '\\') { buf += this.unescape(content[i + 1]); i += 2; continue; }
      if (c === '#' && content[i + 1] === '{') {
        if (buf.length) { parts.push({ str: buf }); buf = ''; }
        i += 2;
        let depth = 1, expr = '';
        while (i < content.length && depth > 0) {
          const d = content[i];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) { i++; break; } }
          expr += d; i++;
        }
        parts.push({ expr });
        continue;
      }
      buf += c; i++;
    }
    if (buf.length || parts.length === 0) parts.push({ str: buf });
    return parts;
  }

  isDelim(c) {
    return c !== undefined && '[({<!|/'.includes(c);
  }
  closeDelim(open) {
    return { '[': ']', '(': ')', '{': '}', '<': '>' }[open] || open;
  }

  scanWords(kind) {
    this.pos += 2; // consume %w
    const open = this.peek();
    const close = this.closeDelim(open);
    this.pos++;
    let buf = '';
    const words = [];
    let depth = 1;
    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c === '\\') { buf += this.peek(1); this.pos += 2; continue; }
      if (open !== close && c === open) { depth++; buf += c; this.pos++; continue; }
      if (c === close) { depth--; if (depth === 0) { this.pos++; break; } buf += c; this.pos++; continue; }
      if (c === ' ' || c === '\t' || c === '\n') { if (c === '\n') this.line++; if (buf.length) { words.push(buf); buf = ''; } this.pos++; continue; }
      buf += c; this.pos++;
    }
    if (buf.length) words.push(buf);
    this.push('WORDS', { kind: kind.toLowerCase(), words });
  }

  // %r{pattern}flags — regex literal with custom delimiters.
  scanPercentRegex() {
    this.pos += 2; // consume %r
    const open = this.peek();
    const close = this.closeDelim(open);
    this.pos++;
    let depth = 1;
    const parts = [];
    let buf = '';
    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c === '\\') { buf += c + (this.peek(1) ?? ''); this.pos += 2; continue; }
      if (open !== close && c === open) { depth++; buf += c; this.pos++; continue; }
      if (c === close) { depth--; if (depth === 0) { this.pos++; break; } buf += c; this.pos++; continue; }
      if (c === '#' && this.peek(1) === '{') {
        if (buf.length) { parts.push({ str: buf }); buf = ''; }
        this.pos += 2;
        parts.push({ expr: this.scanInterpolation() });
        continue;
      }
      if (c === '\n') this.line++;
      buf += c; this.pos++;
    }
    let flags = '';
    while (this.peek() !== undefined && /[imxouesn]/.test(this.peek())) { flags += this.peek(); this.pos++; }
    if (buf.length || parts.length === 0) parts.push({ str: buf });
    this.push('REGEX', { parts, flags });
  }

  // %s{sym} — symbol literal.
  scanPercentSymbol() {
    this.pos += 2;
    const open = this.peek();
    const close = this.closeDelim(open);
    this.pos++;
    let buf = '';
    while (this.pos < this.src.length && this.peek() !== close) { buf += this.peek(); this.pos++; }
    this.pos++;
    this.push('SYMBOL', buf);
  }

  scanPercentString(kind, skip = 2) {
    this.pos += skip; // consume %q or %
    const open = this.peek();
    const close = this.closeDelim(open);
    const interpolate = kind === 'Q';
    this.pos++;
    let depth = 1;
    const parts = [];
    let buf = '';
    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c === '\\') { buf += interpolate ? this.unescape(this.peek(1)) : this.peek(1); this.pos += 2; continue; }
      if (open !== close && c === open) { depth++; buf += c; this.pos++; continue; }
      if (c === close) { depth--; if (depth === 0) { this.pos++; break; } buf += c; this.pos++; continue; }
      if (interpolate && c === '#' && this.peek(1) === '{') {
        if (buf.length) { parts.push({ str: buf }); buf = ''; }
        this.pos += 2;
        parts.push({ expr: this.scanInterpolation() });
        continue;
      }
      if (c === '\n') this.line++;
      buf += c; this.pos++;
    }
    if (buf.length || parts.length === 0) parts.push({ str: buf });
    this.push('STRING', parts);
  }

  scanOperator() {
    // unary `&` block-pass and `*`/`**` splat are handled by the parser via OP.
    for (const op of OPERATORS) {
      if (this.src.startsWith(op, this.pos)) {
        this.pos += op.length;
        this.push('OP', op);
        return;
      }
    }
    this.error(`unexpected character '${this.peek()}'`);
  }
}

export function tokenize(source) {
  return new Lexer(source).tokenize();
}
