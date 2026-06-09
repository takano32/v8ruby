module Geometry
  PI = 3.14159

  class Shape
    @@count = 0
    def initialize
      @@count += 1
    end
    def self.count = @@count
  end

  class Circle < Shape
    def initialize(r)
      super()
      @r = r
    end
    def area = PI * @r * @r
  end

  module Utils
    def self.describe(shape)
      "area = #{shape.area.round(2)}"
    end
  end
end

c1 = Geometry::Circle.new(5)
c2 = Geometry::Circle.new(3)
puts Geometry::PI
puts c1.area.round(2)
puts Geometry::Utils.describe(c2)
puts Geometry::Shape.count

# class with constant and comparison
class Version
  include Comparable
  attr_reader :major, :minor, :patch
  def initialize(str)
    @major, @minor, @patch = str.split(".").map(&:to_i)
  end
  def <=>(other)
    [major, minor, patch] <=> [other.major, other.minor, other.patch]
  end
  def to_s = "#{major}.#{minor}.#{patch}"
end

versions = ["1.2.0", "1.10.1", "1.2.3", "2.0.0"].map { |s| Version.new(s) }
puts versions.sort.map(&:to_s).inspect
puts versions.max.to_s
puts(Version.new("1.2.0") < Version.new("1.10.0"))

# method chaining and tap for debugging
config = Hash.new { |h, k| h[k] = [] }
config[:servers] << "web1"
config[:servers] << "web2"
config[:db] << "primary"
config.each { |k, v| puts "#{k}: #{v.join(', ')}" }

# inject / each_with_object equivalence
nums = (1..10).to_a
sum1 = nums.inject(0) { |acc, n| acc + n }
sum2 = nums.each_with_object([0]) { |n, acc| acc[0] += n }.first
puts "#{sum1} == #{sum2}"

# comparable clamp & between
puts 15.clamp(1..10)
puts 5.between?(1, 10)
puts "m".clamp("a", "z")

# multiple inheritance via modules
module Walkable
  def move = "#{name} walks"
end
module Swimmable
  def swim = "#{name} swims"
end
class Duck
  include Walkable
  include Swimmable
  attr_reader :name
  def initialize(name) = @name = name
end
d = Duck.new("Donald")
puts d.move
puts d.swim
puts Duck.ancestors.map(&:to_s).first(4).inspect
