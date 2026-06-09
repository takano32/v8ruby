# quicksort
def quicksort(arr)
  return arr if arr.length <= 1
  pivot = arr.first
  rest = arr[1..]
  left = rest.select { |x| x < pivot }
  right = rest.select { |x| x >= pivot }
  quicksort(left) + [pivot] + quicksort(right)
end
p quicksort([3, 6, 1, 8, 2, 9, 4])

# method_missing
class Proxy
  def initialize(target)
    @target = target
  end
  def method_missing(name, *args)
    puts "calling #{name}"
    @target.send(name, *args)
  end
  def respond_to_missing?(name, include_private = false)
    @target.respond_to?(name)
  end
end
pr = Proxy.new([1, 2, 3])
puts pr.length
puts pr.sum

# custom exceptions
class ValidationError < StandardError
  def initialize(field)
    super("Invalid field: #{field}")
    @field = field
  end
  attr_reader :field
end

begin
  raise ValidationError.new("email")
rescue ValidationError => e
  puts e.message
  puts e.field
end

# Struct
Point = Struct.new(:x, :y) do
  def distance
    Math.sqrt(x**2 + y**2)
  end
end
pt = Point.new(3, 4)
puts pt.x
puts pt.y
puts pt.distance

# define_method
class Calc
  [:add, :sub].each do |op|
    define_method(op) do |a, b|
      op == :add ? a + b : a - b
    end
  end
end
c = Calc.new
puts c.add(5, 3)
puts c.sub(5, 3)

# enumerable chaining
result = (1..100)
  .select { |n| n % 3 == 0 }
  .map { |n| n * n }
  .take(5)
p result

# freeze
s = "frozen".freeze
puts s.frozen?

# each_with_object building hash
word_count = "the cat the dog the bird".split.each_with_object(Hash.new(0)) do |word, counts|
  counts[word] += 1
end
p word_count
