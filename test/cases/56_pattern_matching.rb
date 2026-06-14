# case/in pattern matching: array, hash, find, value, binding, alternative,
# pin, guards, deconstruct(_keys), and one-line forms.

puts "== array patterns =="
case [1, 2, 3]
in [1, *rest]
  p rest
end
case [1, [2, 3]]
in [a, [b, c]]
  p [a, b, c]
end
case [1, 2, 3, 4]
in [first, *mid, last]
  p [first, mid, last]
end
case [1, 2, 3, 4, 5]
in [*, 3, *post]
  p post
end

puts "== hash patterns =="
case {name: "Alice", age: 30}
in {name: String => n, age: Integer => a}
  p [n, a]
end
case {db: {host: "localhost", port: 5432}}
in {db: {host:, port:}}
  p [host, port]
end
case {a: 1, b: 2, c: 3}
in {a:, **rest}
  p [a, rest]
end
case {a: 1}
in {a: Integer, **nil}
  p "exact"
end

puts "== value / range / pin =="
result = case 5
  in 0 then "zero"
  in 1..10 then "small"
  else "big"
end
p result
expected = 42
case 42
in ^expected then p "pinned"
end
case 10
in ^(2 * 5) then p "expr pin"
end

puts "== alternatives / guards =="
case "b"
in "a" | "b" | "c" => x
  p x
end
case {role: :admin, level: 2}
in {role: :admin, level: Integer => lv} if lv > 5
  p "high"
in {role: :admin, level: lv}
  p "admin #{lv}"
end

puts "== deconstruct protocols =="
class Coord
  def initialize(x, y); @x = x; @y = y; end
  def deconstruct; [@x, @y]; end
  def deconstruct_keys(keys); {x: @x, y: @y}; end
end
case Coord.new(3, 4)
in [a, b]
  p [a, b]
end
case Coord.new(3, 4)
in {x:, y:}
  p [x, y]
end
case Coord.new(3, 4)
in Coord(x:, y:)
  p "Coord #{x},#{y}"
end

puts "== no match raises =="
begin
  case 99
  in String then p "s"
  in Float then p "f"
  end
rescue NoMatchingPatternError
  p "no match"
end

puts "== one-line forms =="
{name: "Bob", age: 20} => {name:, age:}
p [name, age]
p(({a: 1} in {a: Integer}))
p(({a: "x"} in {a: Integer}))
if [1, 2, 3] in [1, *tail]
  p tail
end
[10, 20] => [px, py]
p px + py
