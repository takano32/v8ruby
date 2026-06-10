# Pure-Ruby Date shim for v8ruby (subset of MRI's date stdlib).
# Backed by integer day-count math (proleptic Gregorian). Covers the common
# core: construction, parsing, arithmetic, comparison, strftime, accessors.

class Date
  include Comparable

  MONTHNAMES = [nil, "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"]
  ABBR_MONTHNAMES = [nil, "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  ABBR_DAYNAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  attr_reader :year, :month, :day

  def initialize(year = -4712, month = 1, day = 1)
    @year = year
    @month = month
    @day = day
  end

  def self.civil(y = -4712, m = 1, d = 1)
    new(y, m, d)
  end

  class << self
    alias_method :new!, :new
  end

  def self.today
    t = Time.now
    new(t.year, t.month, t.day)
  end

  def self.leap?(y)
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
  end

  def self.valid_date?(y, m, d)
    return false unless m >= 1 && m <= 12
    return false unless d >= 1 && d <= days_in_month(y, m)
    true
  end

  def self.days_in_month(y, m)
    [nil, 31, leap?(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]
  end

  def self.parse(str, comp = true)
    s = str.to_s.strip
    if s =~ /\A(\d{4})-(\d{1,2})-(\d{1,2})/
      new($1.to_i, $2.to_i, $3.to_i)
    elsif s =~ /\A(\d{1,2})\/(\d{1,2})\/(\d{4})/
      new($3.to_i, $1.to_i, $2.to_i)
    elsif s =~ /\A(\d{4})(\d{2})(\d{2})\z/
      new($1.to_i, $2.to_i, $3.to_i)
    else
      raise ArgumentError, "invalid date"
    end
  end

  def self.strptime(str, fmt)
    parse(str)
  end

  # ---- day-number conversion (days since 0000-03-01, proleptic Gregorian) ----
  def jd
    a = (14 - @month) / 12
    y = @year + 4800 - a
    m = @month + 12 * a - 3
    @day + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045
  end

  def self.jd_to_civil(jd)
    a = jd + 32044
    b = (4 * a + 3) / 146097
    c = a - (146097 * b) / 4
    d = (4 * c + 3) / 1461
    e = c - (1461 * d) / 4
    m = (5 * e + 2) / 153
    day = e - (153 * m + 2) / 5 + 1
    month = m + 3 - 12 * (m / 10)
    year = 100 * b + d - 4800 + m / 10
    new(year, month, day)
  end

  def +(n)
    Date.jd_to_civil(jd + n.to_i)
  end

  def -(other)
    if other.is_a?(Date)
      jd - other.jd
    else
      Date.jd_to_civil(jd - other.to_i)
    end
  end

  def next_day(n = 1) = self + n
  def prev_day(n = 1) = self - n
  def next = self + 1
  alias succ next

  def next_month(n = 1)
    m = @month - 1 + n
    y = @year + m / 12
    m = m % 12 + 1
    d = [@day, Date.days_in_month(y, m)].min
    Date.new(y, m, d)
  end
  def prev_month(n = 1) = next_month(-n)
  def next_year(n = 1) = Date.new(@year + n, @month, @day)
  def prev_year(n = 1) = Date.new(@year - n, @month, @day)

  def <=>(other)
    return nil unless other.is_a?(Date)
    jd <=> other.jd
  end

  def ==(other)
    other.is_a?(Date) && jd == other.jd
  end

  def eql?(other) = self == other
  def hash = jd

  def wday = (jd + 1) % 7
  def yday = jd - Date.new(@year, 1, 1).jd + 1
  def leap? = Date.leap?(@year)
  def mon = @month
  def mday = @day

  def sunday? = wday == 0
  def monday? = wday == 1
  def tuesday? = wday == 2
  def wednesday? = wday == 3
  def thursday? = wday == 4
  def friday? = wday == 5
  def saturday? = wday == 6

  def to_date = self
  def to_time = Time.mktime(@year, @month, @day)

  def strftime(fmt = "%F")
    fmt.gsub(/%[-_0^]?\d*[A-Za-z%]/) do |code|
      c = code[-1]
      case c
      when "Y" then @year.to_s
      when "y" then format("%02d", @year % 100)
      when "m" then format("%02d", @month)
      when "d" then format("%02d", @day)
      when "e" then format("%2d", @day)
      when "j" then format("%03d", yday)
      when "A" then DAYNAMES[wday]
      when "a" then ABBR_DAYNAMES[wday]
      when "B" then MONTHNAMES[@month]
      when "b", "h" then ABBR_MONTHNAMES[@month]
      when "w" then wday.to_s
      when "F" then format("%04d-%02d-%02d", @year, @month, @day)
      when "D" then format("%02d/%02d/%02d", @month, @day, @year % 100)
      when "%" then "%"
      else code
      end
    end
  end

  def iso8601 = strftime("%F")
  def to_s = strftime("%F")
  def inspect = "#<Date: #{strftime('%F')}>"

  def day_fraction = 0
end

class DateTime < Date
  attr_reader :hour, :minute, :second

  def initialize(year = -4712, month = 1, day = 1, hour = 0, minute = 0, second = 0, *_)
    super(year, month, day)
    @hour = hour
    @minute = minute
    @second = second
  end

  def self.now
    t = Time.now
    new(t.year, t.month, t.day, t.hour, t.min, t.sec)
  end

  def self.parse(str, comp = true)
    s = str.to_s.strip
    if s =~ /\A(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2}):(\d{1,2})/
      new($1.to_i, $2.to_i, $3.to_i, $4.to_i, $5.to_i, $6.to_i)
    else
      d = Date.parse(s)
      new(d.year, d.month, d.day)
    end
  end

  def hour = @hour
  def min = @minute
  def sec = @second

  def to_time = Time.mktime(@year, @month, @day, @hour, @minute, @second)

  def strftime(fmt = "%FT%T")
    fmt = fmt.gsub("%T", "%H:%M:%S").gsub("%R", "%H:%M")
    fmt.gsub(/%[-_0^]?\d*[A-Za-z%]/) do |code|
      c = code[-1]
      case c
      when "H" then format("%02d", @hour)
      when "M" then format("%02d", @minute)
      when "S" then format("%02d", @second)
      when "I" then format("%02d", (@hour % 12 == 0 ? 12 : @hour % 12))
      when "p" then @hour < 12 ? "AM" : "PM"
      else super(code)
      end
    end
  end

  def to_s = strftime("%FT%T+00:00")
  def inspect = "#<DateTime: #{strftime('%FT%T')}>"
end
