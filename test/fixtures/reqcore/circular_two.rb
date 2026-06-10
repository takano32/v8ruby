$circ_log ||= []
$circ_log << "two:start"
# At this point circular_one is mid-load: only its pre-require constants exist.
$circ_log << "two:ONE_BEFORE=#{defined?(ONE_BEFORE) ? ONE_BEFORE : "(undefined)"}"
$circ_log << "two:ONE_AFTER=#{defined?(ONE_AFTER) ? ONE_AFTER : "(undefined)"}"
ret = require "circular_one"
$circ_log << "two:require circular_one -> #{ret}"
TWO_CONST = "two_const" unless defined?(TWO_CONST)
$circ_log << "two:end"
