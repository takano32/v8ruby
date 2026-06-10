# Non-local return: a block's `return` exits the method where the block is defined,
# not the method that yields to it.
def with_yield
  yield "a"
  yield "b"
  "method end"
end

def early_caller
  with_yield do |v|
    return "early: #{v}" if v == "a"
  end
  "after"
end
puts early_caller

# block return through each
def find_first_even(arr)
  arr.each { |x| return x if x.even? }
  nil
end
puts find_first_even([1, 3, 4, 7]).inspect

# nested blocks return from outermost method
def deep
  [1, 2].each do |a|
    [3, 4].each do |b|
      return "#{a},#{b}" if b == 4
    end
  end
  "fell through"
end
puts deep

# lambda return only exits the lambda
def lambda_local
  f = -> { return 10 }
  r = f.call
  "lambda gave #{r}, continued"
end
puts lambda_local

# proc return exits enclosing method
def proc_nonlocal
  p = Proc.new { return 20 }
  p.call
  "unreachable"
end
puts proc_nonlocal

# super with a block forwards the block to the superclass method
class Base
  def go
    yield 1, 2
  end
end
class Sub < Base
  def go
    super do |a, b|
      "block got #{a} and #{b}"
    end
  end
end
puts Sub.new.go

# return value from a block-yielding super
class Counter < Base
  def go
    result = nil
    super { |a, b| result = a + b }
    "sum was #{result}"
  end
end
puts Counter.new.go
