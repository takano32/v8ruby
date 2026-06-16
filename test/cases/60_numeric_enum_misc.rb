# Float#floor/ceil/round negative precision (returns Integer), Array#minmax_by,
# Enumerator#to_h, and assorted Enumerable/String gaps.

puts "== float rounding with precision =="
p 10.0.floor(-1)
p 1234.5.floor(-2)
p 1234.5.ceil(-2)
p 1239.5.round(-1)
p 3.14.floor(2)
p 3.7.floor
p 3.14159.round(3)
p 3.14.ceil(1)
p 99.9.floor(-1)
p((10.0.floor(-1)).class)
p((3.14.floor(2)).class)

puts "== minmax / minmax_by =="
p [3, 1, 4, 1, 5].minmax
p [1, 2, 3].minmax_by { |x| -x }
p %w[a bbb cc].minmax_by(&:length)

puts "== Enumerator#to_h and chaining =="
p [10, 20, 30].each_with_index.to_h
p [1, 2, 3].map.with_index { |x, i| [x, i] }.to_h
p [1, 2, 3, 4].each_slice(2).to_a
p [1, 2, 3].each_with_index.map { |x, i| x * i }
p((1..5).each_cons(2).to_a)
p [1, 2, 3, 4].lazy.map { |x| x * x }.first(2)

puts "== String insert / casecmp / tr_s =="
p "hello".insert(-1, "!")
p "hello".insert(0, ">>")
p "Hello".casecmp("hello")
p "Hello".casecmp?("HELLO")
p "abc".casecmp("abd")
p "hello".tr_s("l", "r")
p "aaabbbccc".tr_s("a-c", "x")

puts "== sprintf # flag / truncate(n) =="
p format("%#x", 255)
p format("%#o", 8)
p format("%#b", 10)
p format("%#x", 0)
p 3.14159.truncate(2)
p(-3.14159.truncate(2))
p 1234.truncate(-2)
p 9.99.truncate(1)
