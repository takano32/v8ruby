TWO_FILE = File.basename(__FILE__)
TWO_DIR  = File.basename(__dir__)
TWO_ABS  = File.absolute_path?(__FILE__)

$relchain_order << "two:start"
# ../z is x/z relative to THIS file (x/y/two.rb), not relative to the cwd
# nor relative to the file that required us.
$relchain_ret["two->three"] = require_relative "../z/three.rb"
$relchain_order << "two:end"

def two_report
  "two.rb file=#{TWO_FILE} dir=#{TWO_DIR}"
end
