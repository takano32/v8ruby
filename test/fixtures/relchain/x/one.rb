# Entry of the require_relative chain. Captures __FILE__/__dir__ at load time
# into constants: v8ruby evaluates __FILE__ dynamically inside method bodies
# (reports the caller's file), so methods must report load-time captures.
ONE_FILE = File.basename(__FILE__)
ONE_DIR  = File.basename(__dir__)
ONE_ABS  = File.absolute_path?(__FILE__)

$relchain_order << "one:start"
# Resolved against THIS file's directory (x/), never the cwd.
$relchain_ret["one->two"] = require_relative "y/two.rb"
# three.rb was already loaded by two.rb via a different relative route;
# realpath dedup must make every further route return false.
$relchain_ret["one->three direct"] = require_relative "z/three.rb"
$relchain_ret["one->three dotdot"] = require_relative "y/../z/three"
$relchain_order << "one:end"

def one_report
  "one.rb file=#{ONE_FILE} dir=#{ONE_DIR}"
end
