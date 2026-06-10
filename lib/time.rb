# Time is built into v8ruby runtime. This shim adds the stdlib extension methods.
class Time
  def self.parse(str)
    require 'date' rescue nil
    t = str.to_s.strip
    # ISO 8601 / common formats
    if t =~ /\A(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-]\d{2}:\d{2}))?)?\z/
      y, mo, d = $1.to_i, $2.to_i, $3.to_i
      h, mi, s = ($4 || 0).to_i, ($5 || 0).to_i, ($6 || 0).to_i
      Time.mktime(y, mo, d, h, mi, s)
    else
      Time.now
    end
  end

  def xmlschema(frac = 0)
    strftime("%Y-%m-%dT%H:%M:%S") + (utc? ? "Z" : "+00:00")
  end
  alias iso8601 xmlschema
  alias httpdate to_s

  def self.httpdate(str)
    parse(str)
  end

  def self.xmlschema(str)
    parse(str)
  end
  class << self
    alias iso8601 xmlschema
  end
end
