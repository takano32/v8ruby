# strscan.rb -- pure-Ruby StringScanner shim for v8ruby.
#
# Patterns are matched against the remaining substring (rest). Because regex
# engines return the leftmost match, `m.begin(0) == 0` is equivalent to an
# anchored \A(?:...) match while preserving the pattern's original flags.
# Positions are character-based (MRI uses bytes); identical for ASCII input.
# Known divergence from MRI: \A / ^ / lookbehind inside patterns see only the
# rest substring, not the full string before pos.

class StringScanner
  class Error < StandardError; end

  attr_reader :string

  def initialize(string)
    @string = string
    @pos = 0
    _clear_match
  end

  def pos
    @pos
  end

  def pos=(n)
    n += @string.length if n < 0
    raise RangeError, "index out of range" if n < 0 || n > @string.length
    @pos = n
  end

  def eos?
    @pos >= @string.length
  end

  def rest
    @string[@pos, @string.length - @pos]
  end

  def rest_size
    @string.length - @pos
  end

  def reset
    @pos = 0
    _clear_match
    self
  end

  def terminate
    @pos = @string.length
    _clear_match
    self
  end

  def scan(pattern)
    m0 = _match_anchored(pattern)
    return nil unless m0
    @pos = @match_end
    m0
  end

  def skip(pattern)
    m0 = _match_anchored(pattern)
    return nil unless m0
    @pos = @match_end
    m0.length
  end

  def match?(pattern)
    m0 = _match_anchored(pattern)
    m0 && m0.length
  end

  def check(pattern)
    _match_anchored(pattern)
  end

  def scan_until(pattern)
    s = _match_until(pattern)
    return nil unless s
    @pos = @match_end
    s
  end

  def skip_until(pattern)
    s = _match_until(pattern)
    return nil unless s
    @pos = @match_end
    s.length
  end

  def check_until(pattern)
    _match_until(pattern)
  end

  def exist?(pattern)
    s = _match_until(pattern)
    s && s.length
  end

  def getch
    if eos?
      _clear_match
      return nil
    end
    c = @string[@pos, 1]
    _set_match(@pos, c, [c], [], nil)
    @pos += 1
    c
  end

  def peek(n)
    return "" if eos?  # MRI returns "" at eos even for negative n
    raise ArgumentError, "negative string size (or size too big)" if n < 0
    @string[@pos, n]
  end

  def matched
    @matched_str
  end

  def matched?
    @matched_str ? true : false
  end

  def matched_size
    @matched_str && @matched_str.length
  end

  def pre_match
    @matched_str && @string[0, @match_begin]
  end

  def post_match
    @matched_str && @string[@match_end, @string.length - @match_end]
  end

  def size
    @groups && @groups.size
  end

  def [](key)
    return nil unless @groups
    if key.is_a?(Integer)
      @groups[key]
    else
      name = key.to_s
      if @names.include?(name)
        @match_data[name]
      else
        raise IndexError, "undefined group name reference: " + name
      end
    end
  end

  def unscan
    raise Error, "unscan failed: previous match record not exist" unless @matched_str
    @pos = @prev_pos
    _clear_match
    self
  end

  # -- internal helpers (visibility is not enforced in v8ruby) --

  # Try to match pattern at the current position. Sets/clears the match
  # record; returns the matched string or nil. Does not advance pos.
  def _match_anchored(pattern)
    r = rest
    if pattern.is_a?(String)
      return _clear_match unless r.start_with?(pattern)
      _set_match(@pos, pattern, [pattern], [], nil)
    else
      m = pattern.match(r)
      return _clear_match unless m && m.begin(0) == 0
      _set_match(@pos, m[0], m.to_a, _names_of(pattern), m)
    end
  end

  # Search pattern anywhere after pos. Sets/clears the match record;
  # returns the substring from pos through the end of the match, or nil.
  # Does not advance pos.
  def _match_until(pattern)
    r = rest
    if pattern.is_a?(String)
      idx = r.index(pattern)
      return _clear_match unless idx
      _set_match(@pos + idx, pattern, [pattern], [], nil)
      r[0, idx + pattern.length]
    else
      m = pattern.match(r)
      return _clear_match unless m
      _set_match(@pos + m.begin(0), m[0], m.to_a, _names_of(pattern), m)
      r[0, m.begin(0) + m[0].length]
    end
  end

  def _set_match(begin_abs, m0, groups, names, match_data)
    @prev_pos = @pos
    @match_begin = begin_abs
    @match_end = begin_abs + m0.length
    @matched_str = m0
    @groups = groups
    @names = names
    @match_data = match_data
    m0
  end

  def _clear_match
    @prev_pos = nil
    @match_begin = nil
    @match_end = nil
    @matched_str = nil
    @groups = nil
    @names = nil
    @match_data = nil
    nil
  end

  # Extract named-capture group names from the pattern source. The name must
  # start with a letter/underscore, so lookbehind (?<= (?<! never matches.
  def _names_of(re)
    re.source.scan(/\(\?<([a-zA-Z_][a-zA-Z0-9_]*)>/).map { |g| g[0] }
  end
end
