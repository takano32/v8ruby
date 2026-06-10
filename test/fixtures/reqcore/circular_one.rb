$circ_log ||= []
$circ_log << "one:start"
ONE_BEFORE = "one_before" unless defined?(ONE_BEFORE)
ret = require "circular_two"
$circ_log << "one:require circular_two -> #{ret}"
ONE_AFTER = "one_after" unless defined?(ONE_AFTER)
$circ_log << "one:end"
