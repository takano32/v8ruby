# Bundler compatibility shim for v8ruby.
#
# Workflow: install gems with the REAL `bundle install` (MRI), then run your
# app with v8ruby. This shim reads Gemfile.lock and activates the locked gem
# versions onto $LOAD_PATH (Bundler.setup), and can evaluate the Gemfile DSL
# to `require` each gem (Bundler.require).

require "rubygems"
require "pathname"

module Bundler
  VERSION = "0.1.0 (v8ruby shim)"

  class BundlerError < StandardError; end
  class GemfileNotFound < BundlerError; end
  class GemNotFound < BundlerError; end

  def self.default_gemfile
    env = ENV["BUNDLE_GEMFILE"]
    return File.expand_path(env) if env && !env.empty?
    dir = Dir.pwd
    loop do
      gf = File.join(dir, "Gemfile")
      return gf if File.exist?(gf)
      gf = File.join(dir, "gems.rb")
      return gf if File.exist?(gf)
      parent = File.dirname(dir)
      break if parent == dir
      dir = parent
    end
    nil
  end

  def self.default_lockfile
    gf = default_gemfile
    return nil unless gf
    return gf + ".lock" unless gf.end_with?("gems.rb")
    File.join(File.dirname(gf), "gems.locked")
  end

  def self.root
    gf = default_gemfile
    raise GemfileNotFound, "Could not locate Gemfile" unless gf
    Pathname.new(File.dirname(gf))
  end

  # Parse Gemfile.lock: returns [gems, path_libs] where gems is
  # [[name, version], ...] from GEM sections and path_libs is the lib dirs of
  # `path:` gems (PATH sections), resolved relative to the lockfile.
  def self.parse_lockfile(path)
    gems = []
    path_libs = []
    section = nil
    in_specs = false
    remote = nil
    base = File.dirname(path)
    File.read(path).split("\n").each do |raw|
      if raw =~ /\A[A-Z]/
        section = raw.strip
        in_specs = false
        remote = nil
        next
      end
      stripped = raw.strip
      if stripped == "specs:"
        in_specs = true
        next
      end
      m = raw.match(/\A  remote: (.+)\z/)
      if m
        remote = m[1]
        next
      end
      next unless in_specs
      m = raw.match(/\A    (\S+) \(([^)]+)\)\z/)
      next unless m
      if section == "GEM"
        gems << [m[1], m[2]]
      elsif section == "PATH" && remote
        lib = File.join(File.expand_path(remote, base), "lib")
        path_libs << lib unless path_libs.include?(lib)
      end
    end
    [gems, path_libs]
  end

  # Activate every gem pinned in Gemfile.lock.
  def self.setup(*_groups)
    lf = default_lockfile
    return true unless lf && File.exist?(lf)
    gems, path_libs = parse_lockfile(lf)
    path_libs.each do |lib|
      $LOAD_PATH.unshift(lib) unless $LOAD_PATH.include?(lib)
    end
    missing = []
    gems.each do |name, version|
      # strip platform suffixes like "1.2.3-x86_64-linux"
      v = version.sub(/-[a-z].*\z/, "")
      missing << "#{name} (#{version})" unless Gem.activate(name, v)
    end
    unless missing.empty?
      warn "v8ruby/bundler: locked gems not installed: #{missing.join(', ')} (run `bundle install` with real ruby)"
    end
    @setup_done = true
    true
  end

  def self.setup? = !!@setup_done

  # Evaluate the Gemfile (its `gem` calls are captured, not executed) and
  # require each gem belonging to the requested groups.
  def self.require(*groups)
    setup unless setup?
    groups = [:default] if groups.empty?
    groups = groups.map { |g| g.to_sym }
    entries = eval_gemfile_entries
    entries.each do |args, block_groups|
      name = args[0].to_s
      opts = args[-1].is_a?(Hash) ? args[-1] : {}
      gem_groups = block_groups.map { |g| g.to_sym }
      explicit = opts[:group] || opts[:groups]
      if explicit
        extra = explicit.is_a?(Array) ? explicit : [explicit]
        gem_groups = gem_groups + extra.map { |g| g.to_sym }
      end
      gem_groups = [:default] if gem_groups.empty?
      next if (gem_groups & groups).empty?
      req = opts.key?(:require) ? opts[:require] : nil
      next if req == false
      features = req.nil? ? [name] : (req.is_a?(Array) ? req : [req])
      features.each do |f|
        begin
          Kernel.require(f.to_s)
        rescue LoadError => e
          alt = f.to_s.tr("-", "/")
          raise e if alt == f.to_s
          Kernel.require(alt)
        end
      end
    end
    true
  end

  def self.eval_gemfile_entries
    gf = default_gemfile
    raise GemfileNotFound, "Could not locate Gemfile" unless gf && File.exist?(gf)
    $__gemfile_groups = []
    $__gemfile_capture = []
    captured = nil
    begin
      load gf
    ensure
      captured = $__gemfile_capture
      $__gemfile_capture = nil
      $__gemfile_groups = nil
    end
    captured
  end

  def self.with_unbundled_env = yield
  def self.with_clean_env = yield
  def self.ui = nil
  def self.bundler_version = VERSION
end

# ---- Gemfile DSL ------------------------------------------------------------
# A Gemfile executes at top level; these no-op/bookkeeping methods make its
# DSL parse. `gem` itself is intercepted by the runtime while
# $__gemfile_capture is an array (see Bundler.eval_gemfile_entries).

def source(*_args)
  yield if block_given?
end

def ruby(*_args); end
def gemspec(*_args); end
def git_source(*_args); end

def group(*names)
  $__gemfile_groups ||= []
  names.each { |n| $__gemfile_groups.push(n) }
  yield
ensure
  names.each { $__gemfile_groups.pop } if $__gemfile_groups
end

def platforms(*_args)
  yield if block_given?
end

def platform(*_args)
  yield if block_given?
end

def install_if(*_args)
  yield if block_given?
end

def path(*_args)
  yield if block_given?
end

def git(*_args)
  yield if block_given?
end
