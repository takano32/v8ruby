# Differential test: require_relative resolution chain + __FILE__ + __dir__.
# Fixtures: test/fixtures/relchain/x/one.rb -> y/two.rb -> ../z/three.rb.
# Everything is resolved through __dir__, so the output is cwd-independent
# (verified by running both interpreters from /tmp with absolute paths).
# Note: the main script's own __FILE__ is printed only via derived values,
# because MRI keeps it as typed on the command line.

$relchain_order = []
$relchain_ret = {}

puts "== chain loads relative to each file, not the cwd =="
puts "entry: #{require_relative "../fixtures/relchain/x/one.rb"}"
$relchain_order.each { |e| puts e }
puts "three executed #{$three_loads} time(s)"

puts "== require_relative return values (different routes dedup) =="
$relchain_ret.each { |k, v| puts "#{k}: #{v}" }

puts "== repeat requires return false =="
puts require_relative("../fixtures/relchain/x/one.rb")
puts require_relative("../fixtures/relchain/x/one")
puts require_relative("../fixtures/relchain/x/y/../one.rb")
# plain require with an absolute path hits the same realpath -> false
puts require(File.join(__dir__, "..", "fixtures", "relchain", "x", "z", "three.rb"))

puts "== __FILE__ inside required files is absolute =="
puts "one abs=#{ONE_ABS} two abs=#{TWO_ABS} three abs=#{THREE_ABS}"

puts "== __FILE__/__dir__ as seen by each required file =="
puts one_report
puts two_report
puts three_report
puts "captured: #{ONE_FILE}/#{ONE_DIR} #{TWO_FILE}/#{TWO_DIR} #{THREE_FILE}/#{THREE_DIR}"

puts "== __dir__ of the running script =="
puts File.basename(__dir__)
puts File.absolute_path?(__dir__)
puts File.directory?(__dir__)

puts "== $LOADED_FEATURES bookkeeping =="
feats = $LOADED_FEATURES.select { |f| f.to_s.include?("relchain") }
puts "relchain features: #{feats.size}"
puts feats.map { |f| File.basename(f) }.sort.inspect
puts "all absolute: #{feats.all? { |f| File.absolute_path?(f) }}"
puts "all unique: #{feats.uniq.size == feats.size}"

puts "== missing relative feature raises LoadError =="
begin
  require_relative "../fixtures/relchain/x/zz/nope"
rescue LoadError => e
  puts "rescued #{e.class}"
  puts "message names feature: #{e.message.include?("zz/nope")}"
end
