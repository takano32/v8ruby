# Lazy enumerators (incl. infinite), sprintf %g, Hash#compact, and assorted gaps.

puts "== lazy enumerators =="
p((1..Float::INFINITY).lazy.map { |x| x * x }.first(5))
p((1..Float::INFINITY).lazy.select(&:even?).first(3))
p((1..Float::INFINITY).lazy.map { _1 * 2 }.take(4).to_a)
p([1, 2, 3, 4, 5, 6].lazy.select(&:even?).map { |x| x * 10 }.first(2))
p((1..).lazy.take_while { |x| x < 5 }.to_a)
p((1..Float::INFINITY).lazy.filter_map { |x| x * x if x.even? }.first(3))
p((1..Float::INFINITY).lazy.drop(2).first(3))
p((1..Float::INFINITY).lazy.flat_map { |x| [x, -x] }.first(4))
p((1..10).lazy.select(&:odd?).force)
p((1..Float::INFINITY).lazy.map { |x| x }.with_index.first(3))

puts "== sprintf %g / %e =="
p format("%.3g", 0.0001234)
p format("%g", 100000)
p format("%g", 1000000)
p format("%g", 0.00001)
p format("%.10g", 3.14159265358979)
p format("%G", 0.00001)
p format("%+g", 3.14)
p format("%g", 123.456)
p format("%e", 12345.678)
p format("%+.2f", 3.14159)

puts "== Hash#compact =="
p({ a: 1, b: nil, c: 3 }.compact)
h = { a: 1, b: nil }
h.compact!
p h
p({ a: 1 }.compact!)
