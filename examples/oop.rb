# A small object model: shapes with a Comparable mixin.
class Shape
  include Comparable
  def area = raise NotImplementedError
  def <=>(other) = area <=> other.area
  def to_s = "#{self.class.name}(area=#{area.round(2)})"
end

class Circle < Shape
  def initialize(r) = @r = r
  def area = Math::PI * @r ** 2
end

class Rectangle < Shape
  def initialize(w, h)
    @w, @h = w, h
  end
  def area = @w * @h
end

shapes = [Circle.new(2), Rectangle.new(3, 4), Circle.new(1)]
shapes.sort.each { |s| puts s }
puts "largest: #{shapes.max}"
