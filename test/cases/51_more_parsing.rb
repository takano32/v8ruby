# leading :: resolves to a top-level constant, ignoring lexical nesting
module Wrap
  Token = "top wrap token"
  module Inner
    class Wrap   # shadows the top Wrap module
      def fetch
        ::Wrap::Token
      end
    end
  end
end
puts Wrap::Inner::Wrap.new.fetch

# op-assign / assignment in argument position
h = {}
def take(a, b); "#{a}|#{b.inspect}"; end
puts take(1, h[:k] ||= [])
puts h.inspect
puts take(2, (x = 99))
puts x

# constant on the left of a binary operator continued on the next line
LIST_A = %w[one two
            three]
LIST_B = (LIST_A +
          ["four"]).map { |s| s.upcase }
puts LIST_B.inspect

# def Module::method singleton definition
module Builder
  def Builder::make(n)
    "built #{n}"
  end
end
puts Builder.make(7)

# multi-line %w arrays
WORDS = %w[alpha beta
           gamma delta
           epsilon]
puts WORDS.length
puts WORDS.last
