# Differential test: require / require_relative / load semantics.
# Fixtures live in test/fixtures/reqcore; resolved relative to __dir__ so both
# interpreters see identical paths. Only deltas/derived values are printed.

$LOAD_PATH.unshift File.join(__dir__, "..", "fixtures", "reqcore")

puts "== require returns true then false =="
puts require("a.rb")            # first load, with explicit extension
puts require("a")               # same feature without extension -> false
puts require("a")               # repeat -> false
puts "a executed #{$a_loads} time(s)"
puts "A_VALUE=#{A_VALUE}"
puts a_hello

puts "== require vs require_relative dedup =="
puts require("b")
puts require_relative("../fixtures/reqcore/b")   # same file -> false
puts "b executed #{$b_loads} time(s)"
puts BMod.tag

puts "== absolute-path require dedups too =="
puts require(File.join(__dir__, "..", "fixtures", "reqcore", "a"))
puts require(File.join(__dir__, "..", "fixtures", "reqcore", "a.rb"))

puts "== load executes every time =="
puts load("a.rb")
puts load("a.rb")
puts "a executed #{$a_loads} time(s)"

puts "== circular requires =="
puts require("circular_one")
$circ_log.each { |line| puts line }
puts "ONE_BEFORE=#{ONE_BEFORE} ONE_AFTER=#{ONE_AFTER} TWO_CONST=#{TWO_CONST}"
puts require("circular_two")    # fully loaded by now -> false

puts "== $LOADED_FEATURES deltas =="
before = $LOADED_FEATURES.size
require "c_unique"
puts "delta after fresh require: #{$LOADED_FEATURES.size - before}"
before = $LOADED_FEATURES.size
require "c_unique"
puts "delta after repeat require: #{$LOADED_FEATURES.size - before}"
before = $LOADED_FEATURES.size
load "a.rb"
puts "delta after load: #{$LOADED_FEATURES.size - before}"
puts File.basename($LOADED_FEATURES.last)

puts "== LoadError class semantics =="
begin
  require "no_such_feature_xyz"
rescue LoadError => e
  puts "rescued #{e.class}: #{e.message}"
  puts "LoadError is StandardError? #{e.is_a?(StandardError)}"
  puts "LoadError is ScriptError? #{e.is_a?(ScriptError)}"
end
begin
  begin
    require "no_such_feature_xyz"
  rescue => e
    puts "plain rescue caught #{e.class}"   # must NOT happen
  end
rescue LoadError => e
  puts "outer LoadError rescue caught #{e.class}"
end
begin
  require_relative "no_such_relative_xyz"
rescue LoadError => e
  puts "require_relative rescued #{e.class}"
end

puts "== error raised mid-load propagates =="
begin
  require "raiser"
rescue RuntimeError => e
  puts "rescued #{e.class}: #{e.message}"
end
puts "raiser body ran #{$raiser_attempts} time(s)"
puts "partial constant visible: #{RAISER_PARTIAL}"
puts "post-raise constant defined? #{defined?(RAISER_NEVER) ? "yes" : "no"}"
