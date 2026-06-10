# adjacent string literal concatenation (incl. across line continuations)
a = "hello " "world"
puts a
b = "foo " \
    "bar " \
    "baz"
puts b

# !~ (not-match) operator
puts("abc" !~ /x/)
puts("abc" !~ /b/)

# character literals ?x and ?\n
puts ?a
puts ?\n.inspect
puts ?\t.inspect
puts(?A.ord)

# ternary still works (not confused with char literal)
x = 5
puts(x > 3 ? "big" : "small")

# %-literals with arbitrary delimiters
puts %r"ab.c"i.source
puts %q!single!
puts %w|x y z|.inspect

# leading :: in command args (extend ::Foo)
module Helpers
  def greet; "hi from helper"; end
end
class Widget
  extend ::Helpers
end
puts Widget.greet

# parenthesized statement sequence ending in control flow
[1, 2, 3].each do |n|
  (puts("skip #{n}"); next) if n == 2
  puts "process #{n}"
end

# conditional def inside class << self
class Service
  class << self
    if defined?(SomethingUndefined)
      def mode; "special"; end
    else
      def mode; "normal"; end
    end
  end
end
puts Service.mode
