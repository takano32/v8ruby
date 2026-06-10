# Float-backed BigDecimal shim for v8ruby.
# Real BigDecimal is arbitrary-precision; this approximates with Float, which
# covers the common gem use cases (currency math, config parsing) without the
# C extension. Precision beyond ~15 significant digits is NOT preserved.

class BigDecimal < Numeric
  attr_reader :value

  def initialize(val, _precision = nil)
    case val
    when BigDecimal then @value = val.value
    when String
      s = val.strip
      @value = s.to_f
    when Integer, Float then @value = val.to_f
    when Rational then @value = val.to_f
    else
      @value = val.to_f
    end
  end

  def self.new(val, precision = nil)
    obj = allocate
    obj.send(:initialize, val, precision)
    obj
  end

  def +(o)  = BigDecimal(@value + coerce_val(o))
  def -(o)  = BigDecimal(@value - coerce_val(o))
  def *(o)  = BigDecimal(@value * coerce_val(o))
  def /(o)  = BigDecimal(@value / coerce_val(o))
  def %(o)  = BigDecimal(@value % coerce_val(o))
  def **(o) = BigDecimal(@value ** coerce_val(o))
  def -@    = BigDecimal(-@value)
  def +@    = self
  def abs   = BigDecimal(@value.abs)

  def add(o, _prec = 0) = self + o
  def sub(o, _prec = 0) = self - o
  def mult(o, _prec = 0) = self * o
  def div(o, _prec = 0) = self / o
  def power(o, _prec = 0) = self ** o

  def <=>(o)
    ov = o.is_a?(BigDecimal) ? o.value : (o.respond_to?(:to_f) ? o.to_f : nil)
    return nil if ov.nil?
    @value <=> ov
  end
  include Comparable

  def ==(o)
    return @value == o.value if o.is_a?(BigDecimal)
    return @value == o if o.is_a?(Numeric)
    false
  end

  def zero?     = @value == 0
  def nonzero?  = @value == 0 ? nil : self
  def negative? = @value < 0
  def positive? = @value > 0
  def nan?      = @value.nan?
  def infinite? = @value.infinite?
  def finite?   = @value.finite?

  def sign
    return 0 if @value == 0
    @value > 0 ? 1 : -1
  end

  def to_f = @value
  def to_i = @value.to_i
  def to_int = @value.to_i
  def to_r = @value.to_r
  def to_d = self

  def floor(n = 0)
    return BigDecimal(@value.floor) if n <= 0
    f = 10.0 ** n
    BigDecimal((@value * f).floor / f)
  end

  def ceil(n = 0)
    return BigDecimal(@value.ceil) if n <= 0
    f = 10.0 ** n
    BigDecimal((@value * f).ceil / f)
  end

  def round(n = 0, _mode = nil)
    if n <= 0
      r = @value.round
      n == 0 ? r : BigDecimal(r)
    else
      f = 10.0 ** n
      BigDecimal((@value * f).round / f)
    end
  end

  def truncate(n = 0)
    if n <= 0
      BigDecimal(@value.to_i)
    else
      f = 10.0 ** n
      BigDecimal((@value * f).to_i / f)
    end
  end

  def frac = BigDecimal(@value - @value.to_i)
  def fix  = BigDecimal(@value.to_i)

  def to_s(_fmt = "F")
    if @value == @value.to_i && @value.abs < 1e15
      "#{@value.to_i}.0"
    else
      @value.to_s
    end
  end

  def inspect = to_s
  def hash = @value.hash

  def coerce(o)
    [BigDecimal(o.to_f), self]
  end

  private

  def coerce_val(o)
    o.is_a?(BigDecimal) ? o.value : o.to_f
  end
end

module Kernel
  def BigDecimal(val, precision = nil, exception: true)
    BigDecimal.new(val, precision)
  rescue => e
    raise e if exception
    nil
  end
end
