# OpenStruct shim for v8ruby — pure-Ruby subset of MRI's ostruct.
# Attributes live in @table (Symbol keys); dispatch is done entirely via
# method_missing/respond_to_missing? (no per-field singleton methods).

class OpenStruct
  def initialize(hash = nil)
    @table = {}
    if hash
      hash.each_pair do |k, v|
        @table[k.to_sym] = v
      end
    end
  end

  def to_h(&block)
    if block
      @table.to_h(&block)
    else
      @table.dup
    end
  end

  def each_pair
    unless block_given?
      # v8ruby's to_enum is unreliable; build the Enumerator directly.
      table = @table
      return Enumerator.new { |y| table.each_pair { |k, v| y << [k, v] } }
    end
    # Yield an explicit [k, v] pair: v8ruby's Hash#each_pair passes two args,
    # so a one-parameter block would only receive the key.
    @table.each_pair { |k, v| yield [k, v] }
    self
  end

  def respond_to_missing?(mid, include_private = false)
    mname = mid.to_s.chomp("=").to_sym
    @table.key?(mname) || super
  end

  def method_missing(mid, *args)
    len = args.length
    s = mid.to_s
    if s.end_with?("=") && s.length > 1
      if len != 1
        raise ArgumentError, "wrong number of arguments (given #{len}, expected 1)"
      end
      @table[s.chomp("=").to_sym] = args[0]
    elsif len == 0
      @table[mid]
    else
      raise NoMethodError, "undefined method '#{mid}' for an instance of #{self.class}"
    end
  end

  def [](name)
    @table[name.to_sym]
  end

  def []=(name, value)
    @table[name.to_sym] = value
  end

  def dig(name, *names)
    begin
      name = name.to_sym
    rescue NoMethodError
      raise TypeError, "#{name} is not a symbol nor a string"
    end
    # Manual chaining: v8ruby's Hash#dig does not delegate to objects that
    # define their own #dig (e.g. a nested OpenStruct), so don't use @table.dig.
    value = @table[name]
    return value if names.empty?
    return nil if value.nil?
    value.dig(*names)
  end

  def delete_field(name, &block)
    sym = name.to_sym
    if @table.key?(sym)
      @table.delete(sym)
    elsif block
      block.call
    else
      raise NameError.new("no field '#{sym}' in #{self}", sym)
    end
  end

  def inspect
    detail = @table.map { |k, v| " #{k}=#{v.inspect}" }.join(",")
    "#<#{self.class}#{detail}>"
  end
  alias to_s inspect

  def ==(other)
    return false unless other.is_a?(OpenStruct)
    to_h == other.to_h
  end
end
