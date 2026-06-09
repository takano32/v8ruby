# Merge sort
def merge_sort(arr)
  return arr if arr.length <= 1
  mid = arr.length / 2
  left = merge_sort(arr[0...mid])
  right = merge_sort(arr[mid..])
  merged = []
  until left.empty? || right.empty?
    merged << (left.first <= right.first ? left.shift : right.shift)
  end
  merged + left + right
end
p merge_sort([5, 3, 8, 1, 9, 2, 7])

# Binary search
def bsearch(arr, target)
  lo, hi = 0, arr.length - 1
  while lo <= hi
    mid = (lo + hi) / 2
    return mid if arr[mid] == target
    arr[mid] < target ? lo = mid + 1 : hi = mid - 1
  end
  nil
end
sorted = (1..100).to_a
puts bsearch(sorted, 42)
puts bsearch(sorted, 101).inspect

# Matrix multiply
def matmul(a, b)
  a.map do |row|
    b.transpose.map do |col|
      row.zip(col).sum { |x, y| x * y }
    end
  end
end
m = matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]])
p m

# Mini test DSL
class Spec
  def initialize
    @passed = 0
    @failed = 0
  end
  def expect(actual)
    Expectation.new(actual, self)
  end
  def record(ok)
    ok ? @passed += 1 : @failed += 1
  end
  def report
    "#{@passed} passed, #{@failed} failed"
  end
  class Expectation
    def initialize(actual, spec)
      @actual = actual
      @spec = spec
    end
    def to_eq(expected)
      @spec.record(@actual == expected)
    end
  end
end

spec = Spec.new
spec.expect(1 + 1).to_eq(2)
spec.expect("abc".upcase).to_eq("ABC")
spec.expect([1, 2, 3].sum).to_eq(6)
spec.expect(10 / 3).to_eq(3)
puts spec.report

# Number theory
def prime_factors(n)
  factors = []
  d = 2
  while n > 1
    while n % d == 0
      factors << d
      n /= d
    end
    d += 1
  end
  factors
end
p prime_factors(360)
puts prime_factors(360).tally.map { |k, v| "#{k}^#{v}" }.join(" * ")

# functional pipeline
total = (1..1000)
  .select { |n| n % 3 == 0 || n % 5 == 0 }
  .sum
puts total

# string processing
sentence = "the quick brown fox"
puts sentence.split.map(&:capitalize).join(" ")
puts sentence.chars.tally.max_by { |c, n| n }.first
puts sentence.gsub(/\b\w/) { |c| c.upcase }

# clamp, digits, gcd
puts 15.clamp(1, 10)
puts 1234.digits.inspect
puts 48.gcd(36)
puts [1, 2, 3, 4].each_cons(2).map { |a, b| a + b }.inspect

# do-while
i = 0
begin
  i += 1
end while i < 5
puts i

# hash transformations
inventory = { apples: 30, bananas: 12, cherries: 50 }
puts inventory.select { |k, v| v > 20 }.keys.inspect
puts inventory.sum { |_, v| v }
puts inventory.min_by { |_, v| v }.first
puts inventory.sort_by { |_, v| -v }.to_h.inspect
