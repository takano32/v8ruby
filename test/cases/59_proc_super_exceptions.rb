# Proc arity/curry, block-param defaults, deconstruct_keys, exception cause /
# default messages, bare-super argument forwarding, and a few String methods.

puts "== proc arity =="
p proc { |a, b| }.arity
p proc { |a, b = 1| }.arity
p proc { |a, *b| }.arity
p lambda { |a, b = 1| }.arity
p ->(a, b, c) {}.arity
p ->(*a) {}.arity
p ->(a, b:) {}.arity
p ->(a, b: 2) {}.arity
p ->(**k) {}.arity
p :upcase.to_proc.arity

puts "== block param defaults =="
p [1, 2, 3].map { |x, y = 10| x + y }
add = ->(a, b) { a + b }
p add.curry[1][2]
mul = ->(a, b, c) { a * b * c }
p mul.curry[2][3][4]
p mul.curry[2, 3][4]

puts "== deconstruct_keys (Data / Struct) =="
Point = Data.define(:x, :y)
case Point.new(1, 2)
in { x:, y: }
  p [x, y]
end
S = Struct.new(:a, :b)
case S.new(3, 4)
in { a:, b: }
  p [a, b]
end
p Point.new(5, 6).with(y: 99).y

puts "== exception default message via super =="
class MyError < StandardError
  def initialize(msg = "custom default")
    super
  end
end
begin
  raise MyError
rescue => e
  p e.message
end
begin
  raise MyError, "specific"
rescue => e
  p e.message
end

puts "== exception cause =="
begin
  begin
    raise "original"
  rescue
    raise "wrapped"
  end
rescue => e
  p e.message
  p e.cause&.message
end

puts "== bare super forwarding =="
class Base
  def greet(msg) = "Base: #{msg}"
end
class Sub < Base
  def greet(msg = "default") = super
end
p Sub.new.greet
p Sub.new.greet("explicit")

class A
  def init(name:, age: 0) = "#{name},#{age}"
end
class B < A
  def init(name:, age: 0) = super
end
p B.new.init(name: "x")
p B.new.init(name: "y", age: 5)

puts "== String insert / casecmp =="
p "hello".insert(2, "XX")
p "Hello".casecmp("hello")
p "Hello".casecmp?("hello")
p "abc".casecmp("ABD")
