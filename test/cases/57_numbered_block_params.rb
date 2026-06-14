# Implicit block parameters: numbered (_1.._9) and `it` (Ruby 3.4).

puts "== numbered params =="
p [1, 2, 3].map { _1 * 2 }
p [[1, 2], [3, 4]].map { _1 + _2 }
p [[1, 2, 3], [4, 5, 6]].map { _1 + _2 + _3 }
p({ a: 1, b: 2 }.map { "#{_1}=#{_2}" })
p [1, 2, 3].select { _1.odd? }
p [3, 1, 2].sort { _1 <=> _2 }

puts "== it param =="
p [1, 2, 3].map { it * 3 }
p %w[a b c].map { it.upcase }
p [1, 2, 3, 4].select { it.even? }

puts "== nested blocks keep their own _1 =="
p [[1, 2], [3, 4]].map { |row| row.map { _1 * 10 } }

puts "== mixed with regular usage =="
total = 0
[1, 2, 3].each { total += _1 }
p total
