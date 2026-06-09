require "bundler/setup"
require "rainbow"
require "colorator"

Rainbow.enabled = true
puts Rainbow("bundled").red.inspect
puts "direct".green.inspect
puts Colorator::VERSION
puts defined?(Debug).inspect   # require: false must not load it
