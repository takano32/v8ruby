arr = []; seed = 12345
500_000.times { seed = (seed * 75 + 74) % 65537; arr << seed }
sorted = arr.sort
puts sorted.first + sorted.last
