require "forwardable"

# --- class-level def_delegators with an @ivar accessor ---
class Bag
  extend Forwardable
  def_delegators :"@items", :push, :pop, :size, :include?
  def_delegator :"@items", :first, :head # aliasing form
  def_delegator :"@items", :join
  def initialize
    @items = []
  end
end

bag = Bag.new
p bag.push(1, 2, 3) # multiple args pass through; returns the target array
p bag.push(4)
p bag.pop           # return value comes back from the target
p bag.size
p bag.include?(2)
p bag.include?(99)
p bag.head
p bag.join("-")
p bag.respond_to?(:push)
p bag.respond_to?(:nope)

# --- method accessor (delegate through a reader method) ---
class Wrapper
  extend Forwardable
  def_delegators :inner, :upcase, :length, :chars
  def_delegator :inner, :reverse, :rev
  def_delegator :inner, :center
  def initialize(s)
    @s = s
  end
  def inner
    @s
  end
end

w = Wrapper.new("hello")
p w.upcase
p w.length
p w.chars
p w.rev
p w.center(11, "*")

# --- long-form names, string accessor, delegate hash form ---
class Registry
  extend Forwardable
  def_instance_delegator "@h", :fetch, :grab
  def_instance_delegators "@h", :keys, :key?
  delegate [:store, :delete] => :"@h"
  def initialize
    @h = {}
  end
end

r = Registry.new
p r.store(:a, 1)
p r.store(:b, 2)
p r.grab(:a)
p r.grab(:missing, "dflt")
p r.keys
p r.key?(:b)
p r.delete(:a)
p r.keys

# --- SingleForwardable on individual objects ---
o = Object.new
o.instance_variable_set(:"@data", [10, 20, 30])
o.extend SingleForwardable
o.def_single_delegator :"@data", :first
o.def_single_delegators :"@data", :last, :size
o.def_delegator :"@data", :min, :smallest # def_delegator alias works here too
p o.first
p o.last
p o.size
p o.smallest

# --- SingleForwardable with a method accessor and single_delegate ---
class Holder
  def initialize(h)
    @h = h
  end
  def table
    @h
  end
end

h = Holder.new({ x: 1, y: 2 })
h.extend SingleForwardable
h.def_single_delegators :table, :keys, :length
h.single_delegate [:values] => :table
p h.keys
p h.length
p h.values

puts "done"
