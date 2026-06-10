# Pure-Ruby Base64 shim for v8ruby. API-compatible subset of MRI's base64:
# encode64 / strict_encode64 / decode64 / strict_decode64 /
# urlsafe_encode64 / urlsafe_decode64.
#
# Decoded output: v8ruby has no binary (ASCII-8BIT) strings, so decoded
# byte sequences are reassembled as UTF-8. Valid UTF-8 round-trips and
# prints byte-identically to MRI; arbitrary binary does not.
module Base64
  TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

  DECODE_MAP = {}
  i = 0
  while i < 64
    DECODE_MAP[TABLE[i]] = i
    i += 1
  end

  module_function

  def strict_encode64(bin)
    encode_byte_values(bin.bytes)
  end

  # RFC 2045 style: line breaks every 60 encoded chars + final newline.
  def encode64(bin)
    s = encode_byte_values(bin.bytes)
    out = ""
    i = 0
    len = s.length
    while i < len
      out << s[i, 60]
      out << "\n"
      i += 60
    end
    out
  end

  def urlsafe_encode64(bin, padding: true)
    s = strict_encode64(bin).tr("+/", "-_")
    unless padding
      s = s[0, s.length - 1] while s.end_with?("=")
    end
    s
  end

  def strict_decode64(str)
    n = str.length
    raise ArgumentError, "invalid base64" if n % 4 != 0
    pad = 0
    if n > 0 && str[n - 1] == "="
      pad = str[n - 2] == "=" ? 2 : 1
    end
    vals = []
    i = 0
    limit = n - pad
    while i < limit
      v = DECODE_MAP[str[i]]
      raise ArgumentError, "invalid base64" if v.nil?
      vals << v
      i += 1
    end
    # MRI ("m0") also rejects nonzero discarded bits in the final group.
    if pad == 1
      raise ArgumentError, "invalid base64" if vals.length % 4 != 3 || (vals[-1] & 3) != 0
    elsif pad == 2
      raise ArgumentError, "invalid base64" if vals.length % 4 != 2 || (vals[-1] & 15) != 0
    end
    bytes_to_string(decode_vals_to_bytes(vals))
  end

  # Lenient, like unpack("m"): non-alphabet chars are skipped. "=" is also
  # skipped while fewer than 2 chars of the current group have been seen;
  # once 2 or 3 chars are buffered it flushes the partial group and stops
  # (matches MRI: "=YQ==" => "a", "YWJj=YWJj" => "abcabc").
  def decode64(str)
    vals = []
    pending = 0
    i = 0
    n = str.length
    while i < n
      ch = str[i]
      if ch == "="
        break if pending >= 2
      else
        v = DECODE_MAP[ch]
        unless v.nil?
          vals << v
          pending += 1
          pending = 0 if pending == 4
        end
      end
      i += 1
    end
    bytes_to_string(decode_vals_to_bytes(vals))
  end

  def urlsafe_decode64(str)
    if !str.end_with?("=") && str.length % 4 != 0
      str = str.ljust((str.length + 3) & ~3, "=")
    end
    strict_decode64(str.tr("-_", "+/"))
  end

  # --- helpers (not part of MRI's public API) ---

  def encode_byte_values(bytes)
    out = ""
    i = 0
    len = bytes.length
    while i + 3 <= len
      b1 = bytes[i]
      b2 = bytes[i + 1]
      b3 = bytes[i + 2]
      out << TABLE[b1 >> 2]
      out << TABLE[((b1 & 3) << 4) | (b2 >> 4)]
      out << TABLE[((b2 & 15) << 2) | (b3 >> 6)]
      out << TABLE[b3 & 63]
      i += 3
    end
    rem = len - i
    if rem == 1
      b1 = bytes[i]
      out << TABLE[b1 >> 2]
      out << TABLE[(b1 & 3) << 4]
      out << "=="
    elsif rem == 2
      b1 = bytes[i]
      b2 = bytes[i + 1]
      out << TABLE[b1 >> 2]
      out << TABLE[((b1 & 3) << 4) | (b2 >> 4)]
      out << TABLE[(b2 & 15) << 2]
      out << "="
    end
    out
  end

  # vals are 6-bit alphabet indices; a trailing partial group of 2 or 3
  # yields 1 or 2 bytes (a leftover single char yields nothing).
  def decode_vals_to_bytes(vals)
    bytes = []
    i = 0
    n = vals.length
    while i + 4 <= n
      c1 = vals[i]
      c2 = vals[i + 1]
      c3 = vals[i + 2]
      c4 = vals[i + 3]
      bytes << ((c1 << 2) | (c2 >> 4))
      bytes << (((c2 & 15) << 4) | (c3 >> 2))
      bytes << (((c3 & 3) << 6) | c4)
      i += 4
    end
    rem = n - i
    if rem >= 2
      bytes << ((vals[i] << 2) | (vals[i + 1] >> 4))
      bytes << (((vals[i + 1] & 15) << 4) | (vals[i + 2] >> 2)) if rem == 3
    end
    bytes
  end

  # Reassemble decoded bytes as UTF-8 text. v8ruby's String#<< Integer
  # truncates to a UTF-16 code unit, so astral codepoints are appended
  # as a surrogate pair. Bytes that don't form valid UTF-8 are appended
  # as individual codepoints (best effort; diverges from MRI's binary).
  def bytes_to_string(bytes)
    out = ""
    i = 0
    n = bytes.length
    while i < n
      b = bytes[i]
      cp = nil
      if b < 128
        cp = b
        i += 1
      elsif b >= 194 && b <= 223 && i + 1 < n && cont_byte?(bytes[i + 1])
        cp = ((b - 192) << 6) | (bytes[i + 1] & 63)
        i += 2
      elsif b >= 224 && b <= 239 && i + 2 < n && cont_byte?(bytes[i + 1]) && cont_byte?(bytes[i + 2])
        cp = ((b - 224) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)
        if cp < 2048 || (cp >= 55296 && cp <= 57343)
          cp = b # overlong or surrogate: treat lead byte as a lone codepoint
          i += 1
        else
          i += 3
        end
      elsif b >= 240 && b <= 244 && i + 3 < n && cont_byte?(bytes[i + 1]) && cont_byte?(bytes[i + 2]) && cont_byte?(bytes[i + 3])
        cp = ((b - 240) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63)
        if cp < 65536 || cp > 1114111
          cp = b
          i += 1
        else
          i += 4
        end
      else
        cp = b
        i += 1
      end
      if cp > 65535
        v = cp - 65536
        out << (55296 + (v >> 10))
        out << (56320 + (v & 1023))
      else
        out << cp
      end
    end
    out
  end

  def cont_byte?(b)
    b >= 128 && b <= 191
  end
end
