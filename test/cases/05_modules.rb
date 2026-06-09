module Greetable
  def greet
    "Hi, I'm #{name}"
  end
end

class Person
  include Greetable
  attr_reader :name
  def initialize(name)
    @name = name
  end
end

puts Person.new("Bob").greet
puts Person.ancestors.include?(Greetable)
puts Person.new("X").is_a?(Greetable)

module Counter
  def self.count(arr)
    arr.size
  end
end
puts Counter.count([1, 2, 3])

class Temperature
  include Comparable
  attr_reader :degrees
  def initialize(d)
    @degrees = d
  end
  def <=>(other)
    degrees <=> other.degrees
  end
end

a = Temperature.new(50)
b = Temperature.new(70)
puts a < b
puts [b, a].min.degrees
puts a.between?(Temperature.new(0), Temperature.new(100))
