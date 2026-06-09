# Operator overloading & a Vector value type.
class Vector
  attr_reader :x, :y
  def initialize(x, y)
    @x, @y = x, y
  end
  def +(other) = Vector.new(@x + other.x, @y + other.y)
  def -(other) = Vector.new(@x - other.x, @y - other.y)
  def *(scalar) = Vector.new(@x * scalar, @y * scalar)
  def ==(other) = other.is_a?(Vector) && @x == other.x && @y == other.y
  def <=>(other) = magnitude <=> other.magnitude
  def [](i) = i == 0 ? @x : @y
  def magnitude = Math.sqrt(@x**2 + @y**2)
  def to_s = "(#{@x}, #{@y})"
  def coerce(n) = [Vector.new(n, n), self]
  include Comparable
end

a = Vector.new(1, 2)
b = Vector.new(3, 4)
puts a + b
puts b - a
puts a * 3
puts a == Vector.new(1, 2)
puts a < b
puts [b, a, Vector.new(0, 1)].sort.map(&:to_s).inspect
puts a[0]
puts a[1]
puts [a, b].max.to_s

# enumerable custom class
class NumberRange
  include Enumerable
  def initialize(from, to)
    @from, @to = from, to
  end
  def each
    (@from..@to).each { |n| yield n }
  end
end
nr = NumberRange.new(1, 10)
puts nr.select(&:even?).inspect
puts nr.map { |x| x * x }.inspect
puts nr.reduce(:+)
puts nr.min
puts nr.max
puts nr.include?(5)
puts nr.sort_by { |x| -x }.first(3).inspect
puts nr.partition(&:odd?).inspect
puts nr.group_by { |x| x % 3 }.inspect

# private methods, protected
class BankAccount
  def initialize(balance)
    @balance = balance
  end
  def >(other)
    balance > other.balance
  end
  protected
  def balance = @balance
end
puts(BankAccount.new(100) > BankAccount.new(50))

# kwargs and double splat
def configure(**opts)
  opts.map { |k, v| "#{k}=#{v}" }.sort.join(" ")
end
puts configure(host: "localhost", port: 8080, ssl: true)
opts = { timeout: 30, retries: 3 }
puts configure(**opts)
