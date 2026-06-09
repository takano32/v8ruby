# A minimal JSON serializer written in Ruby.
module MiniJSON
  def self.generate(obj)
    case obj
    when nil then "null"
    when true, false then obj.to_s
    when Integer, Float then obj.to_s
    when String then obj.inspect
    when Symbol then obj.to_s.inspect
    when Array then "[" + obj.map { |x| generate(x) }.join(",") + "]"
    when Hash
      pairs = obj.map { |k, v| "#{k.to_s.inspect}:#{generate(v)}" }
      "{" + pairs.join(",") + "}"
    else
      raise ArgumentError, "cannot serialize #{obj.class}"
    end
  end
end

data = {
  name: "Alice",
  age: 30,
  active: true,
  scores: [95, 87, 92],
  address: { city: "NYC", zip: "10001" },
  nickname: nil
}
puts MiniJSON.generate(data)
puts MiniJSON.generate([1, "two", 3.5, [true, false], { a: 1 }])

# state machine
class TrafficLight
  STATES = { green: :yellow, yellow: :red, red: :green }
  def initialize
    @state = :green
  end
  def next!
    @state = STATES[@state]
  end
  attr_reader :state
end

light = TrafficLight.new
6.times do
  print "#{light.state} "
  light.next!
end
puts

# fancy enumerable
result = (1..20)
  .each_slice(5)
  .map { |slice| slice.sum }
p result.to_a rescue p result

# inject with symbol
puts (1..10).inject(:*)
puts %w[apple banana cherry].max_by(&:length)
puts [1, 2, 3, 4, 5].each_with_index.select { |x, i| i.even? }.map(&:first).inspect
