# catch/throw
result = catch(:done) do
  [1, 2, 3].each do |x|
    throw :done, x * 100 if x == 2
  end
  :never
end
puts result

# exception hierarchy and ensure return
def safe_div(a, b)
  a / b
rescue ZeroDivisionError
  Float::INFINITY
end
puts safe_div(10, 2)
puts safe_div(10, 0)

# case with multiple class types and ranges
def describe(x)
  case x
  when 0 then "zero"
  when 1..9 then "single digit"
  when Integer then "big integer"
  when String then "a string of length #{x.length}"
  when Array then "array of #{x.size}"
  when nil then "nothing"
  else "unknown"
  end
end
[0, 5, 100, "hello", [1, 2], nil, 3.14].each { |x| puts describe(x) }

# tap and then
value = [1, 2, 3]
  .tap { |a| a.push(4) }
  .then { |a| a.sum }
puts value

# send and respond_to?
obj = "hello"
puts obj.send(:upcase)
puts obj.public_send(:length)
puts obj.respond_to?(:upcase)
puts obj.respond_to?(:nonexistent)

# Integer/Float conversions
puts Integer("42")
puts Integer("ff", 16)
puts Float("3.14")
puts "3.14abc".to_f
puts "  42  ".to_i

# frozen string and dup
a = "original".freeze
b = a.dup
b << " modified"
puts a
puts b

# numeric methods
puts 17.to_s(2)
puts 10.times.map { |i| i ** 2 }.inspect
puts (1.0).step(2.0, 0.5).to_a.inspect
puts 3.14159.round(2)
puts (-7).divmod(3).inspect
puts 100.digits(16).inspect

# array flatten with depth
nested = [1, [2, [3, [4, [5]]]]]
p nested.flatten
p nested.flatten(1)
p nested.flatten(2)

# chained conditionals & spaceship
puts [3, 1, 2].sort { |a, b| b <=> a }.inspect
puts %w[banana apple cherry].sort.inspect
puts [1, -2, 3, -4].sort_by(&:abs).inspect

# string format edge cases
puts "Name: %-10s Age: %3d" % ["Bob", 25]
puts "%.2e" % 12345.678
puts "%05.2f%%" % 99.5
