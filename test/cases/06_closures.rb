def make_counter
  count = 0
  increment = -> { count += 1 }
  get = -> { count }
  [increment, get]
end

inc, get = make_counter
inc.call
inc.call
inc.call
puts get.call

def multiplier(factor)
  ->(x) { x * factor }
end
triple = multiplier(3)
puts triple.call(5)

adders = (1..3).map { |n| ->(x) { x + n } }
puts adders.map { |f| f.call(10) }.inspect

# block returning to method scope
def find_first(arr)
  arr.each { |x| return x if yield(x) }
  nil
end
puts find_first([1, 2, 3, 4]) { |x| x > 2 }

# accumulator
sum = 0
[1, 2, 3].each { |x| sum += x }
puts sum
