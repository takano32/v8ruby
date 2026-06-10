# Qualified constant lookup (A::B) searches A's included modules, not just its
# superclass chain — this is how a class that `include`s a module sees that
# module's constants as its own.
module Shared
  WIDTH = 80
  module Mixin
    def helper; "mixin helper"; end
  end
end

class Widget
  include Shared
  include Shared::Mixin
end

# qualified access through the included module
puts Widget::WIDTH
# bare constant reference inside the class resolves through the include
class Widget
  def report; "width is #{WIDTH}"; end
end
puts Widget.new.report
puts Widget.new.helper

# the classic kramdown pattern: a class includes the top-level module, so a
# qualified name resolves the module even when a same-named nested class exists
module App
  module Engine
    class Base; end
    class Renderer; module Helpers; def self.tag; "rendered"; end; end; end
    class App < Base       # same name as the top module
      include ::App        # mixes in the top App module
      def build; App::Engine::Renderer::Helpers.tag; end
    end
  end
end
puts App::Engine::App.new.build

# nested constant defined in a module is visible to a bare reference in an
# including class method
module Config
  TIMEOUT = 30
end
class Server
  include Config
  def timeout; TIMEOUT; end
end
puts Server.new.timeout
