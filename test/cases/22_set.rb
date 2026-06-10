require "set"

puts "== construction =="
s = Set.new
p s
p s.empty?
s = Set.new([3, 1, 2, 3, 1])
p s
p Set.new([1, 2, 3]) { |x| x * 10 }
p Set[]
p Set[5, 5, 6]
p Set["a", :b, 1.5, nil, true]
begin
  Set.new(42)
rescue ArgumentError => e
  puts "#{e.class}: #{e.message}"
end

puts "== add / delete / membership =="
s = Set[1, 2, 3]
p s.add(4)
p s.add(2)
p((s << 5).to_a)
p s.add?(6)
p s.add?(6)
p s.delete(5)
p s.delete(99)
p s.include?(1)
p s.include?(7)
p s.member?(4)
p s === 6
p s === "6"
p s.size
p s.length
p s.count
p s.count(2)
p s.count { |x| x.even? }
p s.empty?

puts "== each / to_a / enumerable =="
s = Set[10, 20, 30]
acc = []
ret = s.each { |x| acc << x }
p acc
p ret.equal?(s)
p ret.class
p s.to_a
p s.map { |x| x + 1 }
p s.select { |x| x > 10 }
p s.reject { |x| x > 10 }
p s.sort
p s.min
p s.max
p s.sum
p s.first
p s.inject(:+)
p s.all? { |x| x >= 10 }
p s.any? { |x| x > 25 }
p s.find { |x| x > 15 }
p s.partition { |x| x > 15 }
p Set[1, 2].each.class

puts "== to_set =="
p [4, 4, 5].to_set
p [].to_set
t = Set[7, 8]
p t.to_set.equal?(t)

puts "== set operations =="
a = Set[1, 2, 3]
b = Set[3, 4]
p a | b
p a.union(b)
p a + b
p a | [4, 1, 5]
p a & b
p a.intersection([2, 9])
p Set[3, 2, 1] & [1, 2, 4]
p a - b
p a.difference([1])
p Set[3, 1] - [1]
p a ^ b
p Set[1, 2, 3] ^ [3, 4]
p a
p b

puts "== comparison =="
p Set[1, 2] == Set[2, 1]
p Set[1, 2] == Set[1, 2, 3]
p Set[1, 2] == [1, 2]
p Set[1, 2] == Set[1, 5]
p Set[1, 2].eql?(Set[2, 1])
p Set[1, 2].eql?(Set[3])
p Set[1, 2].hash == Set[2, 1].hash
p Set.new.hash == Set.new.hash
p Set[1].subset?(Set[1, 2])
p Set[1, 2].subset?(Set[1, 2])
p Set[1, 3].subset?(Set[1, 2])
p Set[1] <= Set[1]
p Set[1, 2].superset?(Set[2])
p Set[1, 2] >= Set[1, 2]
p Set[1, 2] >= Set[3]
p Set[1].proper_subset?(Set[1, 2])
p Set[1] < Set[1]
p Set[1, 2] > Set[2]
p Set[1, 2] > Set[1, 2]
begin
  Set[1].subset?([1, 2])
rescue ArgumentError => e
  puts "#{e.class}: #{e.message}"
end

puts "== merge / dup =="
m = Set[1]
r = m.merge([2, 3], Set[3, 4])
p r.equal?(m)
p m
d = m.dup
d.add(99)
p m.include?(99)
p d.include?(99)
p d.class

puts "== inspect / to_s =="
p Set.new
s = Set[2, 1, "x", :y]
p s
puts s.inspect
puts s.to_s
p Set[Set[1], 2]

puts "== clear / delete_if =="
c = Set[1, 2]
p c.clear
p c
p c.equal?(c.clear)
d = Set[1, 2, 3, 4, 5]
p d.delete_if { |x| x.even? }
p d

puts "== freeze =="
f = Set[1, 2]
p f.frozen?
p f.freeze.equal?(f)
p f.frozen?
begin
  f << 3
rescue => e
  puts "#{e.class}: #{e.message}"
end
begin
  f.delete(1)
rescue => e
  puts "#{e.class}: #{e.message}"
end
p f
g = f.dup
p g.frozen?
p g.add(3)
