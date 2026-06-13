# set.rb -- pure-Ruby Set shim for v8ruby, modeled on Ruby 4.x core Set.
# Backed by a Hash (insertion-ordered, like MRI).

class Set
  include Enumerable

  def self.[](*ary)
    new(ary)
  end

  def initialize(enum = nil, &block)
    @hash = {}
    return if enum.nil?
    if block
      do_with_enum(enum) { |o| add(block.call(o)) }
    else
      merge(enum)
    end
  end

  def dup
    self.class.new(self)
  end

  def size
    @hash.size
  end
  alias length size

  def count(*args, &block)
    if args.empty? && !block
      @hash.size
    else
      to_a.count(*args, &block)
    end
  end

  def empty?
    @hash.empty?
  end

  def add(o)
    @hash[o] = true
    self
  end
  alias << add

  def add?(o)
    include?(o) ? nil : add(o)
  end

  def delete(o)
    @hash.delete(o)
    self
  end

  def delete_if(&block)
    to_a.each { |o| @hash.delete(o) if block.call(o) }
    self
  end

  def clear
    @hash.clear
    self
  end

  def freeze
    @hash.freeze
    super
  end

  def include?(o)
    @hash.key?(o)
  end
  alias member? include?
  alias === include?

  def each(&block)
    return to_a.each unless block_given?
    @hash.each_key(&block)
    self
  end

  def to_a
    @hash.keys
  end

  def to_set(klass = Set, &block)
    return self if self.class == Set && klass == Set && block.nil?
    klass.new(self, &block)
  end

  def merge(*enums)
    enums.each do |enum|
      do_with_enum(enum) { |o| add(o) }
    end
    self
  end

  def |(enum)
    dup.merge(enum)
  end
  alias union |
  alias + |

  # MRI's result preserves the argument's iteration order.
  def &(enum)
    n = self.class.new
    do_with_enum(enum) { |o| n.add(o) if include?(o) }
    n
  end
  alias intersection &

  def -(enum)
    n = dup
    do_with_enum(enum) { |o| n.delete(o) }
    n
  end
  alias difference -

  def ^(enum)
    n = Set.new(enum)
    each { |o| n.include?(o) ? n.delete(o) : n.add(o) }
    n
  end

  def ==(other)
    return true if equal?(other)
    return false unless other.is_a?(Set)
    size == other.size && other.all? { |o| include?(o) }
  end

  def eql?(other)
    other.is_a?(Set) && self == other
  end

  # Order-independent; only equality of hash values matters (not MRI's exact numbers).
  def hash
    h = 472882027 ^ size
    each { |o| h ^= o.hash }
    h
  end

  def subset?(set)
    check_set(set)
    size <= set.size && all? { |o| set.include?(o) }
  end
  alias <= subset?

  def superset?(set)
    check_set(set)
    set.subset?(self)
  end
  alias >= superset?

  def proper_subset?(set)
    check_set(set)
    size < set.size && all? { |o| set.include?(o) }
  end
  alias < proper_subset?

  def proper_superset?(set)
    check_set(set)
    set.proper_subset?(self)
  end
  alias > proper_superset?

  def inspect
    items = to_a.map { |o| o.inspect }.join(", ")
    "#<#{self.class}: {#{items}}>"
  end
  alias to_s inspect

  private

  def check_set(set)
    raise ArgumentError, "value must be a set" unless set.is_a?(Set)
  end

  def do_with_enum(enum, &block)
    if enum.is_a?(Set) || enum.respond_to?(:each)
      enum.each(&block)
    else
      raise ArgumentError, "value must be enumerable"
    end
  end
end

module Enumerable
  def to_set(klass = Set, &block)
    klass.new(self, &block)
  end
end

# Explicit, in case Enumerable reopening ever stops propagating to Array.
class Array
  def to_set(klass = Set, &block)
    klass.new(self, &block)
  end
end
