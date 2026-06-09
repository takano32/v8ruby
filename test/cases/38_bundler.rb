ENV["BUNDLE_GEMFILE"] = File.expand_path(File.join(__dir__, "..", "fixtures", "bundle_app", "Gemfile"))
require "bundler/setup"
require "rainbow"
require "colorator"

Rainbow.enabled = true
puts Rainbow("bundled").red.inspect
puts "direct".green.inspect
puts Colorator::VERSION
puts defined?(Debug).inspect

require "bundler"
Bundler.require(:default)
puts Rainbow("required").blue.inspect
puts Bundler.root.to_s.end_with?("bundle_app")
