# Classes, inheritance, attr, methods
class Animal
  attr_accessor :name, :sound
  def initialize(name, sound)
    @name = name
    @sound = sound
  end
  def speak
    "#{@name} says #{@sound}"
  end
  def to_s
    "Animal(#{@name})"
  end
end

class Dog < Animal
  def initialize(name)
    super(name, "Woof")
  end
  def speak
    super + "!"
  end
end

d = Dog.new("Rex")
puts d.speak
puts d.name
puts d.to_s
d.name = "Max"
puts d.speak

# blocks, iterators
total = 0
[1, 2, 3, 4, 5].each { |n| total += n }
puts "total: #{total}"

squares = (1..5).map { |x| x * x }
p squares

evens = (1..10).select { |x| x.even? }
p evens

# hash
h = { "a" => 1, "b" => 2 }
h.each { |k, v| puts "#{k}=#{v}" }
puts h.map { |k, v| v * 10 }.sum

# string methods
s = "Hello, World"
puts s.upcase
puts s.downcase
puts s.length
puts s.split(", ").inspect
puts s.reverse
