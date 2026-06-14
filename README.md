# v8ruby

A Ruby implementation that **compiles Ruby to JavaScript and runs it on the V8 engine** (via Node.js). Your Ruby program becomes JavaScript and is JIT-compiled and executed by V8 — so V8 really is the engine running Ruby.

```
$ v8ruby -e 'puts "Hello from V8 Ruby!"'
Hello from V8 Ruby!
```

## How it works

```
Ruby source
   │  src/lexer.js      tokenize (handles interpolation, heredocs, %w[], symbols…)
   ▼
 Tokens
   │  src/parser.js     recursive-descent + Pratt precedence → AST
   ▼
  AST
   │  src/compiler.js   two-pass: (1) scope analysis for Ruby local-variable
   │                    semantics, (2) emit JavaScript
   ▼
JavaScript ──► new Function('R', js)(R) ──► executed on V8
                         │
                   src/runtime.js   the Ruby object model + core classes
                                     (Integer, Float, String, Symbol, Array,
                                      Hash, Range, Proc, Struct, Enumerator,
                                      Comparable, Enumerable, exceptions, …)
```

Every method call and operator is compiled to a single dynamic-dispatch entry
point, `R.send(recv, name, args, block)`, so Ruby semantics are preserved:

- **Truthiness** — only `nil` and `false` are falsy (`0` and `""` are truthy).
- **Integer vs Float** — `1 / 2 == 0` but `1.0 / 2 == 0.5`.
- **Everything is an object** — `3.times`, `"x".upcase`, `nil.to_a`.
- **Open classes, `method_missing`, `respond_to?`, operator overloading.**
- **Blocks, procs, lambdas, `yield`**, non-local `return`/`break`/`next`.
- **`super`**, modules/mixins (`include`), `Comparable`, `Enumerable`.
- **Exceptions** — `begin`/`rescue`/`ensure`/`retry`, custom exception classes.

## Usage

```sh
bin/ruby.js program.rb        # run a file
bin/ruby.js -e 'puts 1 + 1'   # run a one-liner
bin/ruby.js --dump program.rb # print the generated JavaScript
bin/ruby.js -v                # version (shows the underlying V8 version)
```

(No build step and no dependencies — just Node.js.)

## Supported language features

Literals (int, float, string with `#{}` interpolation, symbols, arrays, hashes,
ranges, `%w[]`/`%i[]`, heredocs `<<~`), all operators, multiple assignment and
destructuring, splat/keyword/block/default parameters, `if`/`unless`/`case`/
`while`/`until`/`for`, ternary, `&&`/`||`/`and`/`or`/`not`, method calls with and
without parentheses, safe navigation `&.`, blocks (`{}` and `do…end`), procs and
stabby lambdas (`->(){}`), endless methods (`def f = …`), classes with
inheritance and `super`, singleton/class methods (`def self.x`), modules,
`attr_accessor`, `Struct`, `class_eval`/`define_method`, and a large slice of the
core library.

See `examples/` for sample programs and `test/cases/` for feature tests.

## Tests

`test/run.js` is a **differential** test runner: it runs each `test/cases/*.rb`
through both v8ruby and the real `ruby` interpreter (if installed) and diffs the
output.

```sh
node test/run.js
```

## Limitations

This is a from-scratch implementation of a large language; it targets the common
core, not 100% of MRI. Notable gaps: no real threads/fibers, no full `Regexp`
(simple `String#match`/`gsub` only), `Rational`/`Complex` are approximate,
mutation of frozen objects isn't enforced, and only a subset of the enormous
standard library is present.

## License

MIT
