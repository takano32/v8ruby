# Class.new with a block: def/attr inside target the new anonymous class
K = Class.new do
  attr_reader :val
  def initialize(x); @val = x * 3; end
end
puts K.new(7).val

# Class.new with explicit superclass and block
Base1 = Class.new { def kind; "base"; end }
Sub1 = Class.new(Base1) { def extra; "extra"; end }
s = Sub1.new
puts s.kind
puts s.extra

# A class nested in a module with the SAME name as a top-level constant
# reopens the nested one, not the global module.
module Pkg
  module Parser
    class Helper; def role; "real helper"; end; end
  end
end
module Pkg
  module Parser
    class Pkg < Helper   # same name as the top module
      def tag; "nested pkg"; end
    end
  end
end
obj = Pkg::Parser::Pkg.new
puts obj.role
puts obj.tag

# Two modules autoloading the same constant name must not collide
File.write("/tmp/_v8_x.rb", "module XMod; class Common; def id; 'X'; end; end; end")
File.write("/tmp/_v8_y.rb", "module YMod; class Common; def id; 'Y'; end; end; end")
module XMod; autoload :Common, "/tmp/_v8_x.rb"; end
module YMod; autoload :Common, "/tmp/_v8_y.rb"; end
puts XMod::Common.new.id
puts YMod::Common.new.id
File.delete("/tmp/_v8_x.rb")
File.delete("/tmp/_v8_y.rb")

# autoloaded constant used as a superclass via lexical lookup
File.write("/tmp/_v8_base.rb", "module Lib; class AutoBase; def hi; 'auto base'; end; end; end")
module Lib
  autoload :AutoBase, "/tmp/_v8_base.rb"
  class Derived < AutoBase
    def yo; "derived"; end
  end
end
d = Lib::Derived.new
puts d.hi
puts d.yo
File.delete("/tmp/_v8_base.rb")
