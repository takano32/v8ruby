# RubyGems compatibility shim for v8ruby.
# Gem discovery/activation lives in the JS loader (src/loader.js); this file
# adds the pure-Ruby pieces gems commonly touch at runtime.

module Gem
  class LoadError < ::LoadError; end

  class Version
    include Comparable
    attr_reader :version

    def self.new(input)
      input.is_a?(Version) ? input : super
    end

    def self.correct?(str)
      !str.to_s.match(/\A\s*\d+(\.\w+)*\s*\z/).nil?
    end

    def self.create(input)
      return input if input.is_a?(Version)
      return nil if input.nil?
      new(input)
    end

    def initialize(version)
      @version = version.to_s.strip
    end

    def segments
      @version.scan(/\d+|[a-zA-Z]+/).map do |s|
        s.match(/\A\d+\z/) ? s.to_i : s
      end
    end

    def <=>(other)
      other = Version.new(other) unless other.is_a?(Version)
      a = segments
      b = other.segments
      i = 0
      limit = a.size > b.size ? a.size : b.size
      while i < limit
        x = i < a.size ? a[i] : 0
        y = i < b.size ? b[i] : 0
        if x.is_a?(Integer) && y.is_a?(Integer)
          c = x <=> y
        elsif x.is_a?(Integer)
          c = 1   # 1.0.0 > 1.0.beta
        elsif y.is_a?(Integer)
          c = -1
        else
          c = x.to_s <=> y.to_s
        end
        return c unless c == 0
        i += 1
      end
      0
    end

    def to_s = @version
    def inspect = "#<Gem::Version \"#{@version}\">"
    def prerelease? = !@version.match(/[a-zA-Z]/).nil?
    def release
      return self unless prerelease?
      Version.new(@version.sub(/\.?[a-zA-Z].*\z/, ""))
    end
    def bump
      segs = segments.select { |s| s.is_a?(Integer) }
      segs.pop if segs.size > 1
      segs[-1] = segs[-1] + 1
      Version.new(segs.join("."))
    end
  end

  class Requirement
    OPS = {
      "=" => ->(v, r) { v == r },
      "!=" => ->(v, r) { v != r },
      ">" => ->(v, r) { v > r },
      "<" => ->(v, r) { v < r },
      ">=" => ->(v, r) { v >= r },
      "<=" => ->(v, r) { v <= r },
      "~>" => ->(v, r) { v >= r && v.release < r.bump },
    }

    def self.new(*reqs)
      reqs = reqs.flatten
      reqs = [">= 0"] if reqs.empty?
      super(reqs)
    end

    def initialize(reqs)
      @requirements = reqs.map { |r| parse(r) }
    end

    def parse(obj)
      return ["=", obj] if obj.is_a?(Version)
      m = obj.to_s.match(/\A\s*(=|!=|>=|<=|~>|>|<)?\s*([\d\w.]+)\s*\z/)
      raise ArgumentError, "Illformed requirement [#{obj.inspect}]" if m.nil?
      [m[1] || "=", Version.new(m[2])]
    end

    def satisfied_by?(version)
      version = Version.new(version) unless version.is_a?(Version)
      @requirements.all? { |op, rv| OPS[op].call(version, rv) }
    end

    def ===(version) = satisfied_by?(version)
    def =~(version) = satisfied_by?(version)
  end

  def self.ruby_version
    Version.new(RUBY_VERSION)
  end
end
