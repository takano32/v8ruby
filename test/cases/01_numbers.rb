puts 10 / 3
puts 10 % 3
puts 10.0 / 3
puts 2 ** 10
puts(-7 / 2)
puts(-7 % 3)
puts 3.14.round
puts 3.14.floor
puts 3.14.ceil
puts 3.7.round(0)
puts 3.14159.round(2)
puts 10.gcd(15)
puts 4.lcm(6)
puts 255.to_s(16)
puts "ff".to_i(16)
puts 5.times.to_a.inspect rescue puts (0...5).to_a.inspect
puts (1..10).reduce(:+)
puts (1..5).inject { |a, b| a * b }
puts [3, 1, 2].sort.inspect
puts [3, 1, 2].max
puts 17.even?
puts 17.odd?
puts 0.zero?
puts((-5).abs)
puts 7.fdiv(2)
puts 10.divmod(3).inspect
