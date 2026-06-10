require "ostruct"

# --- seeded attributes ---
o = OpenStruct.new(name: "matz", lang: "ruby")
p o.class
p o.name
p o.lang

# unknown attribute reads as nil
p o.unknown

# --- dynamic setter then getter ---
o.year = 1993
p o.year
o2 = OpenStruct.new
p o2.to_h
o2.x = 10
o2.y = 20
p o2.x + o2.y

# string keys in the seed hash become symbols
o3 = OpenStruct.new("a" => 1, :b => 2)
p o3.a
p o3.to_h

# --- [] and []= with symbol or string keys ---
p o3[:a]
p o3["b"]
o3["c"] = 3
o3[:d] = 4
p o3.to_h
p o3.c

# --- respond_to? for seeded and dynamic fields ---
p o.respond_to?(:name)
p o.respond_to?(:name=)
p o.respond_to?(:year)
p o.respond_to?(:nope)

# to_h returns a copy of the table
h = o2.to_h
h[:zzz] = 99
p o2.to_h

# --- each_pair: order, block return value, enumerator ---
res = o.each_pair { |k, v| p [k, v] }
p res.equal?(o)
e = o.each_pair
p e.class
p e.to_a

# --- inspect (and to_s) ---
p OpenStruct.new.inspect
p o.inspect
p OpenStruct.new(s: "hi", n: nil, arr: [1, 2], sym: :z).inspect
p OpenStruct.new(inner: OpenStruct.new(b: 2)).inspect
p o.to_s == o.inspect

# --- == ---
p(OpenStruct.new(a: 1) == OpenStruct.new(a: 1))
p(OpenStruct.new(a: 1) == OpenStruct.new(a: 2))
p(OpenStruct.new(a: 1) == OpenStruct.new(a: 1, b: 2))
p(OpenStruct.new(a: 1) == { a: 1 })
p(o == o)

# --- delete_field ---
df = OpenStruct.new(a: 1, b: 2)
p df.delete_field(:a)
p df.to_h
p df.delete_field("b")
p df.to_h
p df.a
p df.respond_to?(:a)
begin
  df.delete_field(:missing)
rescue NameError => ex
  puts "#{ex.class}: #{ex.message}"
end
fallback = df.delete_field(:still_missing) { :fallback }
p fallback

# --- dig ---
nested = OpenStruct.new(x: OpenStruct.new(y: 5), h: { k: [10, 20] })
p nested.dig(:x)
p nested.dig(:x, :y)
p nested.dig("x", :y)
p nested.dig(:x, :zz)
p nested.dig(:h, :k, 1)
p nested.dig(:absent)

# --- subclassing ---
class Profile < OpenStruct; end
prof = Profile.new(id: 7)
p prof.id
prof.role = "admin"
p prof.role
p prof.inspect
p(prof == OpenStruct.new(id: 7, role: "admin"))
