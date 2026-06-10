a = (1..1_000_000).to_a
puts a.map { |x| x * 2 }.select { |x| x % 3 == 0 }.reduce(0) { |acc, x| acc + x }
