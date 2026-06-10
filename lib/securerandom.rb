# Pure-Ruby SecureRandom shim for v8ruby.
# Backed by Kernel#rand — NOT cryptographically secure; API-compatible subset.
module SecureRandom
  HEX_DIGITS = "0123456789abcdef"
  ALPHANUMERIC_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  BASE64_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

  def self.random_number(n = 0)
    if n.is_a?(Integer) && n > 0
      rand(n)
    elsif n.is_a?(Float) && n > 0
      rand * n
    else
      rand
    end
  end

  # Returns a string of n chars with codepoints 0..255. Note: in v8ruby
  # strings are UTF-8, so bytesize may exceed n; length is always n.
  def self.random_bytes(n = nil)
    n = 16 if n.nil?
    s = ""
    n.times { s << rand(256).chr }
    s
  end

  def self.bytes(n)
    random_bytes(n)
  end

  def self.hex(n = nil)
    n = 16 if n.nil?
    s = ""
    (n * 2).times { s << HEX_DIGITS[rand(16)] }
    s
  end

  def self.alphanumeric(n = nil)
    n = 16 if n.nil?
    s = ""
    n.times { s << ALPHANUMERIC_CHARS[rand(62)] }
    s
  end

  # RFC 4122 version 4 UUID: version nibble "4", variant nibble in [89ab].
  def self.uuid
    s = ""
    8.times { s << HEX_DIGITS[rand(16)] }
    s << "-"
    4.times { s << HEX_DIGITS[rand(16)] }
    s << "-4"
    3.times { s << HEX_DIGITS[rand(16)] }
    s << "-"
    s << "89ab"[rand(4)]
    3.times { s << HEX_DIGITS[rand(16)] }
    s << "-"
    12.times { s << HEX_DIGITS[rand(16)] }
    s
  end

  def self.base64(n = nil)
    n = 16 if n.nil?
    encode64(random_byte_values(n))
  end

  def self.urlsafe_base64(n = nil, padding = false)
    n = 16 if n.nil?
    s = encode64(random_byte_values(n))
    s = s.gsub("+", "-").gsub("/", "_")
    s = s.gsub("=", "") unless padding
    s
  end

  def self.random_byte_values(n)
    a = []
    n.times { a << rand(256) }
    a
  end

  def self.encode64(byte_values)
    out = ""
    i = 0
    len = byte_values.length
    while i < len
      b1 = byte_values[i]
      b2 = byte_values[i + 1]
      b3 = byte_values[i + 2]
      out << BASE64_TABLE[b1 >> 2]
      if b2.nil?
        out << BASE64_TABLE[(b1 & 3) << 4]
        out << "=="
      elsif b3.nil?
        out << BASE64_TABLE[((b1 & 3) << 4) | (b2 >> 4)]
        out << BASE64_TABLE[(b2 & 15) << 2]
        out << "="
      else
        out << BASE64_TABLE[((b1 & 3) << 4) | (b2 >> 4)]
        out << BASE64_TABLE[((b2 & 15) << 2) | (b3 >> 6)]
        out << BASE64_TABLE[b3 & 63]
      end
      i += 3
    end
    out
  end
end
