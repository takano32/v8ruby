# A small interpreter-ish program: tokenize and sum an arithmetic expr.
class Calculator
  def initialize(expr)
    @tokens = expr.scan(/\d+|[+\-*\/()]/)
    @pos = 0
  end

  def parse
    result = term
    while peek == "+" || peek == "-"
      op = advance
      result = op == "+" ? result + term : result - term
    end
    result
  end

  def term
    result = factor
    while peek == "*" || peek == "/"
      op = advance
      result = op == "*" ? result * factor : result / factor
    end
    result
  end

  def factor
    if peek == "("
      advance
      result = parse
      advance # )
      result
    else
      advance.to_i
    end
  end

  def peek = @tokens[@pos]
  def advance
    t = @tokens[@pos]
    @pos += 1
    t
  end
end

["2 + 3 * 4", "(2 + 3) * 4", "10 - 2 - 3", "2 * (3 + 4) * 5"].each do |e|
  puts "#{e} = #{Calculator.new(e).parse}"
end

# Hash-based memoization and enumerable pipelines
primes = (2..50).select do |n|
  (2...n).none? { |d| n % d == 0 }
end
p primes
puts "sum of primes: #{primes.sum}"
puts "count: #{primes.count}"

# string building
table = (1..5).map do |i|
  (1..5).map { |j| (i * j).to_s.rjust(3) }.join
end.join("\n")
puts table

# grouping and counting
words = "apple banana apple cherry banana apple".split
freq = words.group_by(&:itself).transform_values(&:size)
freq.sort_by { |w, c| [-c, w] }.each { |w, c| puts "#{w}: #{c}" }
