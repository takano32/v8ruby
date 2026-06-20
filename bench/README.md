# Benchmarks: Ruby vs v8ruby

Microbenchmarks comparing MRI Ruby against v8ruby (Ruby → JavaScript → V8).

Run them yourself:

```sh
for f in bench/*.rb; do
  echo "== $f =="
  time ruby "$f"
  time ./v8ruby "$f"
done
```

## Results

Environment: ruby 4.0.2 (PRISM, aarch64-linux) · Node.js v26.2.0 · median of 5 runs.

### Wall-clock time (whole process, ms)

| Benchmark | Workload                          |  ruby | v8ruby | v8ruby / ruby |
|-----------|-----------------------------------|------:|-------:|--------------:|
| startup   | `puts "hello"`                    |   373 |    210 |     **0.56x** |
| loop      | 5,000,000-iteration sum           |   432 |    484 |         1.12x |
| array     | 1M-elem map → select → reduce     |   512 |    524 |         1.02x |
| sort      | 500,000-element sort              |   482 |    538 |         1.12x |
| string    | 1,000,000 `<<` appends            |   376 |    606 |         1.61x |
| hash      | 1M inserts + full iteration       |   757 |   2245 |         2.97x |
| fib       | `fib(33)` recursion               |   721 |   2423 |         3.36x |

### Compute only (wall-clock minus startup, ms)

| Benchmark | ruby | v8ruby | ratio |
|-----------|-----:|-------:|------:|
| loop      |   59 |    274 |  4.6x |
| array     |  139 |    314 |  2.3x |
| sort      |  109 |    328 |  3.0x |
| hash      |  384 |   2035 |  5.3x |
| fib       |  348 |   2213 |  6.4x |

## Takeaways

- **Startup is faster on v8ruby** (210 ms vs 373 ms) thanks to V8's snapshot
  start. Short scripts favor v8ruby.
- **Compute-heavy work is 2–6× faster on MRI.** v8ruby compiles Ruby to JS and
  runs it on V8, but every method call goes through a dynamic `R.send()`
  dispatch, which dominates recursion (`fib`) and hash-heavy code.
- **For small-to-medium scripts where startup dominates, wall-clock is roughly
  even** (loop/array/sort land at 1.0–1.1×).

Notes: the `string` compute estimate is omitted (MRI finishes in ~startup time,
making the subtraction noisy). Workloads are kept within JS's safe-integer range
because large integer sums (e.g. `i*i`) diverge once MRI promotes them to bignum.
