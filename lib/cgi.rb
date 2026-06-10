# Pure-Ruby CGI utility shim for v8ruby (escape/unescape subset only).
# Note: v8ruby has no hex integer literals and $1 is nil inside gsub blocks,
# so this file uses decimal constants and block-parameter parsing throughout.
class CGI
  module Util
    # application/x-www-form-urlencoded: space => '+', unreserved
    # [A-Za-z0-9_.~-] pass through, everything else %XX (uppercase, per byte).
    def escape(string)
      encode_www_component(string, "+")
    end

    # Same charset as escape, but space => %20 (RFC 3986 component style).
    def escapeURIComponent(string)
      encode_www_component(string, "%20")
    end

    def unescape(string)
      decode_percent(string.to_s.gsub("+", " "))
    end

    # Like unescape but '+' is NOT treated as space.
    def unescapeURIComponent(string)
      decode_percent(string.to_s)
    end

    def escapeHTML(string)
      string.to_s.gsub(/['&"<>]/) do |m|
        case m
        when "&" then "&amp;"
        when "<" then "&lt;"
        when ">" then "&gt;"
        when '"' then "&quot;"
        when "'" then "&#39;"
        end
      end
    end

    # Entity names are case-sensitive in MRI; the hex marker x/X is not.
    def unescapeHTML(string)
      string.to_s.gsub(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#[xX][0-9A-Fa-f]+);/) do |m|
        inner = m[1..-2]
        case inner
        when "amp"  then "&"
        when "lt"   then "<"
        when "gt"   then ">"
        when "quot" then "\""
        when "apos" then "'"
        else # numeric: #NN or #xHH
          if inner[1] == "x" || inner[1] == "X"
            cp = inner[2..-1].to_i(16)
          else
            cp = inner[1..-1].to_i
          end
          # MRI leaves out-of-range references untouched.
          cp <= 1114111 ? codepoint_str(cp) : m
        end
      end
    end

    alias escape_uri_component escapeURIComponent
    alias unescape_uri_component unescapeURIComponent
    alias escape_html escapeHTML
    alias unescape_html unescapeHTML
    alias h escapeHTML

    private

    def encode_www_component(string, space)
      out = ""
      string.to_s.chars.each do |ch|
        if ch =~ /\A[A-Za-z0-9_.\-~]\z/
          out << ch
        elsif ch == " "
          out << space
        else
          ch.bytes.each { |b| out << ("%%%02X" % b) }
        end
      end
      out
    end

    # Decode runs of %XX; anything malformed (bad hex, truncated) is copied
    # through verbatim, matching MRI.
    def decode_percent(str)
      out = ""
      i = 0
      n = str.length
      while i < n
        if str[i] == "%" && i + 2 < n && hex_digit?(str[i + 1]) && hex_digit?(str[i + 2])
          bytes = []
          while i + 2 < n && str[i] == "%" && hex_digit?(str[i + 1]) && hex_digit?(str[i + 2])
            bytes << (str[i + 1] + str[i + 2]).to_i(16)
            i += 3
          end
          out << utf8_bytes_str(bytes)
        else
          out << str[i]
          i += 1
        end
      end
      out
    end

    def hex_digit?(ch)
      !(ch =~ /\A[0-9a-fA-F]\z/).nil?
    end

    # No String#pack in v8ruby: rebuild characters from UTF-8 byte sequences
    # by computing codepoints arithmetically.
    def utf8_bytes_str(bytes)
      out = ""
      i = 0
      n = bytes.length
      while i < n
        b = bytes[i]
        if b < 128
          out << b.chr
          i += 1
        elsif b >= 194 && b <= 223 && i + 1 < n && cont_byte?(bytes[i + 1])
          out << codepoint_str((b - 192) * 64 + (bytes[i + 1] - 128))
          i += 2
        elsif b >= 224 && b <= 239 && i + 2 < n && cont_byte?(bytes[i + 1]) && cont_byte?(bytes[i + 2])
          out << codepoint_str((b - 224) * 4096 + (bytes[i + 1] - 128) * 64 + (bytes[i + 2] - 128))
          i += 3
        elsif b >= 240 && b <= 244 && i + 3 < n && cont_byte?(bytes[i + 1]) && cont_byte?(bytes[i + 2]) && cont_byte?(bytes[i + 3])
          out << codepoint_str((b - 240) * 262144 + (bytes[i + 1] - 128) * 4096 + (bytes[i + 2] - 128) * 64 + (bytes[i + 3] - 128))
          i += 4
        else
          # Invalid UTF-8 byte: MRI keeps the raw byte (binary garbage);
          # best effort here is the codepoint of the byte value.
          out << b.chr
          i += 1
        end
      end
      out
    end

    def cont_byte?(b)
      b >= 128 && b <= 191
    end

    # Integer#chr in v8ruby is UTF-16 based; astral codepoints need an
    # explicit surrogate pair.
    def codepoint_str(cp)
      if cp < 65536
        cp.chr
      else
        v = cp - 65536
        (55296 + v / 1024).chr + (56320 + v % 1024).chr
      end
    end
  end

  include Util
  extend Util

  class << self
    public :escape, :escapeURIComponent, :unescape, :unescapeURIComponent,
           :escapeHTML, :unescapeHTML,
           :escape_uri_component, :unescape_uri_component,
           :escape_html, :unescape_html, :h
  end
end
