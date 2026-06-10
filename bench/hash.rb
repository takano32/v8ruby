h = {}
1_000_000.times { |i| h[i] = i % 1000 }
sum = 0; h.each { |k, v| sum += v }; puts sum
