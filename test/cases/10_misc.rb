# multiple return + destructuring
def min_max(arr)
  [arr.min, arr.max]
end
lo, hi = min_max([3, 1, 4, 1, 5, 9, 2, 6])
puts "#{lo}..#{hi}"

# splat
def total(*nums)
  nums.sum
end
puts total(1, 2, 3, 4)

# keyword args
def greet(name:, greeting: "Hello")
  "#{greeting}, #{name}!"
end
puts greet(name: "World")
puts greet(name: "Ruby", greeting: "Hi")

# default args
def power(base, exp = 2)
  base ** exp
end
puts power(5)
puts power(2, 10)

# string formatting
puts format("Pi is approximately %.4f", 3.14159)
printf("%-10s|%10s|\n", "left", "right")

# nested data
data = { users: [{ name: "A", age: 30 }, { name: "B", age: 25 }] }
puts data[:users].map { |u| u[:name] }.inspect
puts data[:users].sum { |u| u[:age] }
puts data[:users].max_by { |u| u[:age] }[:name]

# ranges and step
puts (0..10).step(2).to_a.inspect
puts ("a".."e").to_a.inspect
puts (1..3).flat_map { |x| (1..3).map { |y| [x, y] } }.length

# conditional assignment chains
config = {}
config[:timeout] ||= 30
config[:timeout] ||= 60
puts config[:timeout]
