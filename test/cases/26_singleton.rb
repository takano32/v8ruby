require "singleton"

class Config
  include Singleton
  attr_accessor :value
  def initialize
    puts "Config initialized"
    @value = 0
  end
end

class Logger
  include Singleton
  def initialize
    puts "Logger initialized"
    @lines = []
  end
  def log(msg)
    @lines << msg
    self
  end
  def lines
    @lines
  end
end

puts "-- lazy init --"
puts "before first access"
c = Config.instance
puts "after first access"
c2 = Config.instance
puts c.equal?(c2)
puts Config.instance.equal?(Config.instance)

puts "-- shared state --"
Config.instance.value = 42
puts Config.instance.value
Config.instance.value += 1
puts c.value

puts "-- independence --"
l = Logger.instance
puts l.equal?(Config.instance)
puts l.class
puts c.class
l.log("a").log("b")
puts Logger.instance.lines.inspect

puts "-- new raises --"
begin
  Config.new
rescue NoMethodError => e
  puts e.class
  puts e.message
end
begin
  Logger.new
rescue => e
  puts "#{e.class}: #{e.message}"
end

puts "-- allocate raises --"
begin
  Config.allocate
rescue NoMethodError => e
  puts e.message
end

puts "-- clone/dup raise --"
begin
  Config.instance.clone
rescue TypeError => e
  puts e.class
  puts e.message
end
begin
  Logger.instance.dup
rescue => e
  puts "#{e.class}: #{e.message}"
end
# instance still intact after failed clone/dup
puts Config.instance.equal?(c)
puts Config.instance.value

puts "-- namespaced --"
module App
  class Cache
    include Singleton
    def initialize
      @h = {}
    end
    def []=(k, v)
      @h[k] = v
    end
    def [](k)
      @h[k]
    end
  end
end
App::Cache.instance[:x] = "hi"
puts App::Cache.instance[:x]
begin
  App::Cache.new
rescue NoMethodError => e
  puts e.message
end
begin
  App::Cache.instance.clone
rescue TypeError => e
  puts e.message
end

puts "-- misc --"
puts Config.instance.frozen?
puts Config.include?(Singleton)
puts Config.instance.is_a?(Singleton)
puts Logger.instance.is_a?(Logger)
