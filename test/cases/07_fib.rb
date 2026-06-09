def fib(n)
  return n if n < 2
  fib(n - 1) + fib(n - 2)
end
puts (0..15).map { |n| fib(n) }.inspect

# iterative
def fib_iter(n)
  a, b = 0, 1
  n.times { a, b = b, a + b }
  a
end
puts (0..15).map { |n| fib_iter(n) }.inspect

# memoized with hash
def fib_memo(n, cache = {})
  return n if n < 2
  cache[n] ||= fib_memo(n - 1, cache) + fib_memo(n - 2, cache)
end
puts fib_memo(30)
