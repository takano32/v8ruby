h = { name: "Alice", age: 30, city: "NYC" }
puts h[:name]
puts h.keys.inspect
puts h.values.inspect
puts h.map { |k, v| "#{k}=#{v}" }.join(", ")
puts h.select { |k, v| k == :age }.inspect
puts h.transform_values { |v| v.to_s }.inspect
puts h.each_with_object({}) { |(k, v), acc| acc[v] = k }.inspect
counts = Hash.new(0)
"hello".each_char { |c| counts[c] += 1 }
p counts
puts h.fetch(:name)
puts h.fetch(:missing, "default")
puts h.key?(:age)
puts h.merge({ age: 31 }).inspect
puts h.to_a.inspect
g = { 1 => "one", 2 => "two" }
puts g.invert.inspect
puts({ a: 1, b: 2 }.sum { |k, v| v })
puts({ a: 3, b: 1, c: 2 }.min_by { |k, v| v }.inspect)
puts({ a: 3, b: 1, c: 2 }.sort_by { |k, v| v }.inspect)
