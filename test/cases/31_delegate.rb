require "delegate"

puts "== basic forwarding (array target) =="
sd = SimpleDelegator.new([1, 2, 3])
puts sd.length
puts sd.first
puts sd.last(2).inspect
puts sd.map { |x| x * 10 }.inspect
puts sd.include?(2)
sd.push(4)
puts sd.inspect
puts sd.join("-")
puts sd.sum
puts sd.sort { |a, b| b <=> a }.inspect
acc = []
sd.each_with_index { |v, i| acc << "#{i}:#{v}" }
puts acc.join(",")

puts "== string target =="
s = SimpleDelegator.new("hello world")
puts s.upcase
puts s.split(" ").inspect
puts s.length
puts (s =~ /world/).inspect
puts (s <=> "hello").inspect
puts (s === "hello world").inspect
puts s.hash == "hello world".hash
puts s.to_s
puts s.inspect
puts "interp: #{s}"

puts "== numeric target / operators =="
n = SimpleDelegator.new(42)
puts (n + 8).inspect
puts (n * 2).inspect
puts n.zero?
puts n.even?
puts n.to_s

puts "== hash target =="
hd = SimpleDelegator.new({ a: 1, b: 2 })
puts hd[:a]
hd[:c] = 3
puts hd.size
puts hd.keys.inspect
puts hd.fetch(:b)

puts "== equality =="
puts (sd == [1, 2, 3, 4]).inspect
puts (sd == [9]).inspect
puts (sd != [9]).inspect
puts (sd == sd).inspect
puts sd.eql?(sd)
puts sd.eql?([1, 2, 3, 4])
puts (SimpleDelegator.new(nil) == nil).inspect

puts "== __getobj__ / __setobj__ swap =="
d = SimpleDelegator.new("abc")
puts d.upcase
puts d.__getobj__.inspect
d.__setobj__([10, 20])
puts d.sum
puts d.__getobj__.inspect
puts d.respond_to?(:upcase)
puts d.respond_to?(:sum)

puts "== respond_to? =="
puts sd.respond_to?(:length)
puts sd.respond_to?(:no_way)
puts sd.respond_to?(:__getobj__)
puts sd.respond_to?(:__setobj__)
puts sd.methods.include?(:length)
puts sd.methods.include?(:__getobj__)

puts "== class identity =="
puts sd.class
puts sd.instance_of?(SimpleDelegator)
puts sd.instance_of?(Array)
puts sd.is_a?(SimpleDelegator)
puts sd.is_a?(Delegator)
puts sd.is_a?(Array)
puts sd.kind_of?(Delegator)
puts SimpleDelegator.superclass
puts sd.nil?
puts SimpleDelegator.new(nil).nil?

puts "== missing methods =="
begin
  sd.no_such_method
rescue NoMethodError => e
  puts e.class
  puts e.message
end

puts "== abstract Delegator =="
begin
  Delegator.new(1)
rescue NotImplementedError => e
  puts e.class
  puts e.message
end

begin
  x = SimpleDelegator.new(1)
  x.__setobj__(x)
rescue ArgumentError => e
  puts e.class
  puts e.message
end

puts "== dup / clone copy the target =="
orig = SimpleDelegator.new([1, 2])
copy = orig.dup
copy.push(3)
puts orig.inspect
puts copy.inspect
puts copy.class
puts copy.__getobj__.equal?(orig.__getobj__)
c2 = orig.clone
puts c2.__getobj__.equal?(orig.__getobj__)

puts "== freeze freezes the target too =="
target = [5]
fd = SimpleDelegator.new(target)
fd.freeze
puts fd.frozen?
puts target.frozen?

puts "== subclassing =="
# The portable decorator pattern: subclass methods reach the wrapped object
# through __getobj__ (rather than relying on super falling through to
# method_missing-based delegation).
class Shouter < SimpleDelegator
  def shout
    __getobj__.upcase + "!"
  end

  def char_count
    "chars=#{__getobj__.length}"
  end
end

dec = Shouter.new("ruby")
puts dec.shout
puts dec.char_count
puts dec.reverse
puts dec.class
puts dec.is_a?(SimpleDelegator)
puts dec.is_a?(Delegator)
puts dec.respond_to?(:shout)
puts dec.respond_to?(:reverse)

# An override shadows the delegated method; everything else still forwards.
class Quiet < SimpleDelegator
  def to_s
    "[quiet #{__getobj__}]"
  end
end

q = Quiet.new("LOUD")
puts q
puts q.downcase
puts q.length
q.__setobj__("SILENT")
puts q

puts "done"
