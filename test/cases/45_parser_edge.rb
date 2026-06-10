# unary operator method names -@ +@
class Vec
  def initialize(x); @x = x; end
  def -@; Vec.new(-@x); end
  def +@; self; end
  def x; @x; end
end
puts((-Vec.new(5)).x)
puts((+Vec.new(3)).x)

# assignment inside when condition
v = nil
result = case
when (v = 10) > 100 then "huge"
when (v = 7) > 5 then "med #{v}"
else "small"
end
puts result

# duplicate _ parameters in block/lambda
f = ->(_, _, c) { c }
puts f.call(1, 2, 3)

pairs = [[1, 2, 3], [4, 5, 6]]
puts pairs.map { |_, _, z| z }.inspect

# singleton attr_accessor via class << self
class Config
  class << self
    attr_accessor :setting
  end
end
Config.setting = "on"
puts Config.setting

# gsub with block using $1
puts "a1b2".gsub(/([a-z])(\d)/) { "#{$2}#{$1}" }
puts "foo bar".gsub(/(\w+)/) { $1.capitalize }
