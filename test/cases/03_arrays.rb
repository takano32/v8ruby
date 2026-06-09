a = [1, 2, 3, 4, 5]
puts a.map { |x| x * 2 }.inspect
puts a.select(&:even?).inspect
puts a.reject(&:even?).inspect
puts a.reduce(0) { |s, x| s + x }
puts a.sum
puts a.min
puts a.max
puts a.minmax.inspect
puts a.partition(&:even?).inspect
puts a.group_by { |x| x % 2 }.inspect
puts a.each_slice(2).to_a.inspect
puts a.each_cons(2).to_a.inspect
puts a.flat_map { |x| [x, -x] }.inspect
puts a.zip([6, 7, 8]).inspect
puts a.take(2).inspect
puts a.drop(2).inspect
puts a.take_while { |x| x < 3 }.inspect
puts [[1, 2], [3, 4]].flatten.inspect
puts [1, 2, 2, 3, 3, 3].uniq.inspect
puts [1, 2, 3].include?(2)
puts [3, 1, 2].sort_by { |x| -x }.inspect
puts [1, 2, 3].reverse.inspect
puts (1..5).to_a.inspect
puts [1, 2, 3].each_with_index.map { |x, i| "#{i}:#{x}" }.inspect rescue puts [1,2,3].map.with_index { |x,i| "#{i}:#{x}" }.inspect
puts ["a", "b", "c"].each_with_index.to_a.inspect
puts [1, 2, 3, 4].each_with_object([]) { |x, acc| acc << x * x }.inspect
puts [1, 2, 3].cycle.first(7).inspect rescue puts "skip"
h = [1, 2, 3].tally
p [1, 1, 2, 3, 3, 3].tally
