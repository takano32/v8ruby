# break/next with values
r = [1, 2, 3, 4, 5].each { |x| break x * 10 if x == 3 }
puts r
sq = [1, 2, 3, 4].map { |x| next 0 if x.even?; x }
p sq

# nested blocks capturing
def counter_factory
  counters = []
  3.times do |i|
    count = i * 10
    counters << -> { count += 1 }
  end
  counters
end
counter_factory.each { |c| puts c.call }

# ensure always runs
def with_resource
  puts "acquire"
  yield
ensure
  puts "release"
end
with_resource { puts "use" }
begin
  with_resource { raise "boom" }
rescue => e
  puts "rescued: #{e.message}"
end

# retry
attempts = 0
begin
  attempts += 1
  raise "fail" if attempts < 3
  puts "succeeded after #{attempts} attempts"
rescue
  retry if attempts < 3
end

# string mutation
s = "abc"
s << "def"
s << 33
puts s
buf = +""
%w[a b c].each { |x| buf << x << "-" }
puts buf

# heredoc with interpolation
name = "World"
text = <<~MSG
  Hello, #{name}!
  The answer is #{6 * 7}.
MSG
puts text

# multiple assignment swaps and splat
a, b, c = 1, 2, 3
a, b = b, a
puts [a, b, c].inspect
first, *rest = [10, 20, 30, 40]
puts first
p rest
*init, last = [1, 2, 3, 4]
p init
puts last
x, (y, z) = 1, [2, 3]
puts [x, y, z].inspect

# safe navigation
obj = nil
puts obj&.upcase.inspect
puts "hi"&.upcase

# conditional modifiers and chained comparisons
nums = (1..20).to_a
puts nums.select { |n| n > 5 && n < 15 && n.odd? }.inspect

# format precision
puts format("%08.3f", 3.14159)
puts format("%+d %x %o %b", 42, 255, 8, 5)
puts format("%-10s|", "hi")
puts "%c%c%c" % [72, 73, 33]
