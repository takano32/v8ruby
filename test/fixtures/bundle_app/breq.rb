ENV["BUNDLE_GEMFILE"] = File.expand_path("Gemfile", __dir__)
require "bundler"
Bundler.require(:default)
Rainbow.enabled = true
puts Rainbow("via Bundler.require").blue.inspect
puts "c".red.inspect
puts defined?(Debug).inspect
