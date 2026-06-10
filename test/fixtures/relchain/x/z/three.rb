# Leaf of the chain; reachable through several relative routes but must
# execute exactly once. Even though it is required from x/y/two.rb, its own
# __FILE__/__dir__ must point at x/z/three.rb.
$three_loads = ($three_loads || 0) + 1

THREE_FILE = File.basename(__FILE__)
THREE_DIR  = File.basename(__dir__)
THREE_ABS  = File.absolute_path?(__FILE__)

$relchain_order << "three:start"
$relchain_order << "three:end"

def three_report
  "three.rb file=#{THREE_FILE} dir=#{THREE_DIR}"
end
