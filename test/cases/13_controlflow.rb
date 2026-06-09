# control flow + case
def classify(n)
  case
  when n < 0 then "negative"
  when n == 0 then "zero"
  when n < 10 then "small"
  else "big"
  end
end
[-5, 0, 3, 100].each { |n| puts classify(n) }

case "hello"
when Integer then puts "int"
when String then puts "string"
end

# while, until, loop with break
i = 0
while i < 3
  puts "i=#{i}"
  i += 1
end

n = 0
n += 1 until n >= 3
puts "n=#{n}"

count = 0
loop do
  count += 1
  break if count > 5
end
puts "count=#{count}"

# ternary, &&, ||
x = 5
puts(x > 3 ? "yes" : "no")
puts(nil || "default")
puts(false && "never" || "fallback")

# exceptions
def risky(v)
  raise ArgumentError, "too big" if v > 100
  raise "generic" if v < 0
  v * 2
end

begin
  puts risky(50)
  puts risky(200)
rescue ArgumentError => e
  puts "caught arg: #{e.message}"
rescue => e
  puts "caught: #{e.message}"
ensure
  puts "cleanup"
end

begin
  puts risky(-1)
rescue => e
  puts "#{e.class}: #{e.message}"
end

# proc / lambda / yield
def with_log
  puts "before"
  result = yield(10)
  puts "after: #{result}"
end
with_log { |x| x * 3 }

double = ->(n) { n * 2 }
puts double.call(21)
puts double.(21)
puts double[21]

# symbol to proc
puts [1, 2, 3].map(&:to_s).inspect
puts %w[a b c].map(&:upcase).inspect rescue puts ["a","b","c"].map(&:upcase).inspect
