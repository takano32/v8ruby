require "json"

puts "== generate scalars =="
puts JSON.generate(nil)
puts JSON.generate(true)
puts JSON.generate(false)
puts JSON.generate(0)
puts JSON.generate(42)
puts JSON.generate(-7)
puts JSON.generate(1.5)
puts JSON.generate(0.0012)
puts JSON.generate(-2000.0)
puts JSON.generate(25000000000.0)
puts JSON.generate(3.14159)

puts "== generate strings =="
puts JSON.generate("hello")
puts JSON.generate("")
puts JSON.generate("say \"hi\"")
puts JSON.generate("back\\slash")
puts JSON.generate("line1\nline2\ttab\rcr")
puts JSON.generate("bs\b ff\f")
puts JSON.generate("ctl::end")
puts JSON.generate("slash/not/escaped")
puts JSON.generate("unicode: é ü 日本語")
puts JSON.generate("emoji: \u{1F600}")
puts JSON.generate(:a_symbol)

puts "== generate containers =="
puts JSON.generate([])
puts JSON.generate({})
puts JSON.generate([1, 2, 3])
puts JSON.generate([nil, true, false, "x", 1.5, [2, [3]]])
puts JSON.generate({ "a" => 1, "b" => "two" })
puts JSON.generate({ sym: :value, "str" => [1, { inner: nil }] })
puts JSON.generate({ 1 => "one", nil => "nil-key", 2.5 => "float-key" })
puts JSON.generate([{ "deep" => [[], {}, [{}]] }])
puts JSON.dump({ a: [1, 2], b: { c: true } })

puts "== to_json =="
puts nil.to_json
puts true.to_json
puts false.to_json
puts 123.to_json
puts((-4.25).to_json)
puts "str\n".to_json
puts :sym.to_json
puts [1, "two", :three].to_json
puts({ "k" => [false, nil] }.to_json)

class Point
  def initialize(x, y)
    @x = x
    @y = y
  end

  def to_s
    "(#{@x},#{@y})"
  end
end

class Pair
  def initialize(a, b)
    @a = a
    @b = b
  end

  def to_json(*args)
    JSON.generate([@a, @b])
  end
end

puts Point.new(1, 2).to_json
puts JSON.generate(Point.new(3, 4))
puts JSON.generate([Point.new(5, 6)])
puts Pair.new(7, "x").to_json
puts JSON.generate({ "pair" => Pair.new(8, nil) })
puts JSON.generate(1..3)

puts "== pretty_generate =="
puts JSON.pretty_generate({ "a" => 1, "b" => [1, 2, { "c" => nil }], "d" => {}, "e" => [], "f" => { "g" => true } })
puts JSON.pretty_generate([1, [2, 3], {}, [], "x"])
puts JSON.pretty_generate(5)
puts JSON.pretty_generate({ sym: [true, { k: "v" }] })

puts "== parse scalars =="
p JSON.parse("null")
p JSON.parse("true")
p JSON.parse("false")
p JSON.parse("0")
p JSON.parse("42")
p JSON.parse("-17")
p JSON.parse("3.14")
p JSON.parse("-0.5")
p JSON.parse("1e3")
p JSON.parse("2.5E2")
p JSON.parse("1.2e-3")
p JSON.parse("-3e2")
p JSON.parse('"plain"')
p JSON.parse('""')

puts "== parse strings/escapes =="
p JSON.parse('"a\nb\tc"')
p JSON.parse('"q:\" bs:\\\\ sl:\/"')
p JSON.parse('"\b\f\r"').length
p JSON.parse('"Aéあ"')
emoji = JSON.parse('"😀"')
puts emoji
puts emoji.length
puts emoji == "\u{1F600}"

puts "== parse containers =="
p JSON.parse("[]")
p JSON.parse("{}")
p JSON.parse("[1, 2, 3]")
p JSON.parse('  [ 1 ,  "two" , null , true , [false] ]  ')
p JSON.parse('{"a": 1, "b": [1.5, -2e3, null, true, false, "é"], "c": {}}')
p JSON.parse("{\n  \"x\": {\"y\": [10, 20]},\r\n\t\"z\": \"w\"\n}")
p JSON.parse('{"": "empty key", "dup space  ": 1}')

puts "== symbolize_names =="
p JSON.parse('{"a": 1, "b": {"c": [{"d": null}]}}', symbolize_names: true)
p JSON.parse('[{"x": 1}, {"y": 2}]', symbolize_names: true)
p JSON.parse('{"a": "values stay strings"}', symbolize_names: true)
p JSON.parse("[1, 2]", symbolize_names: true)

puts "== round trips =="
data = { "name" => "v8ruby", "tags" => ["json", "shim"], "meta" => { "ok" => true, "score" => 9.5, "none" => nil } }
json = JSON.generate(data)
puts json
back = JSON.parse(json)
puts back == data
puts JSON.generate(back) == json
pretty = JSON.pretty_generate(data)
puts JSON.parse(pretty) == data
puts JSON.parse(JSON.generate("é\n\t\u{1F600}")) == "é\n\t\u{1F600}"
puts JSON.parse(JSON.generate([0.0012, -2000.0, 25000000000.0])).inspect

puts "== parser errors =="
[
  "",
  "{",
  "[1,]",
  '{"a":1,}',
  "01",
  "1.",
  "- 1",
  "[1] x",
  '{"a" 1}',
  "tru",
  '"ab',
  '"a\x"',
  '"a\u12"',
  "[1 2]",
  "{'a':1}",
  "[]"
].each do |bad|
  begin
    JSON.parse(bad)
    puts "NO ERROR"
  rescue JSON::ParserError => e
    puts e.class
  end
end

begin
  JSON.parse("{{")
rescue StandardError => e
  puts "rescued as StandardError: #{e.is_a?(JSON::ParserError)}"
end

puts "== generator errors =="
begin
  JSON.generate(0.0 / 0.0)
rescue JSON::GeneratorError => e
  puts e.class
end
begin
  JSON.generate([1.0 / 0.0])
rescue JSON::GeneratorError => e
  puts e.class
end
begin
  JSON.generate({ "neg" => -1.0 / 0.0 })
rescue JSON::GeneratorError => e
  puts e.class
end

puts "done"
