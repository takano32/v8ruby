# Pure-Ruby JSON shim for v8ruby.
# Implements JSON.generate / JSON.dump / JSON.pretty_generate / JSON.parse
# (with symbolize_names:) plus to_json on core classes.
# Note: v8ruby does not support hex integer literals, so char codes below
# are written in decimal (34 = '"', 92 = '\', 32 = space, ...).

module JSON
  class JSONError < StandardError; end
  class ParserError < JSONError; end
  class GeneratorError < JSONError; end

  def self.generate(obj, *rest)
    gen_value(obj)
  end

  def self.dump(obj, *rest)
    gen_value(obj)
  end

  def self.pretty_generate(obj, *rest)
    pretty_value(obj, 0)
  end

  def self.parse(source, symbolize_names: false)
    Parser.new(source.to_s, symbolize_names).run
  end

  def self.gen_value(obj)
    if obj.nil?
      "null"
    elsif obj.is_a?(TrueClass)
      "true"
    elsif obj.is_a?(FalseClass)
      "false"
    elsif obj.is_a?(Float)
      gen_float(obj)
    elsif obj.is_a?(Integer)
      obj.to_s
    elsif obj.is_a?(String)
      gen_string(obj)
    elsif obj.is_a?(Symbol)
      gen_string(obj.to_s)
    elsif obj.is_a?(Array)
      parts = obj.map { |e| gen_value(e) }
      "[" + parts.join(",") + "]"
    elsif obj.is_a?(Hash)
      parts = obj.map { |k, v| gen_string(key_string(k)) + ":" + gen_value(v) }
      "{" + parts.join(",") + "}"
    else
      # Mirrors MRI: unknown objects serialize via their own to_json
      # (Object#to_json below falls back to to_s).
      obj.to_json
    end
  end

  def self.gen_float(f)
    raise GeneratorError, "NaN not allowed in JSON" if f.nan?
    raise GeneratorError, "Infinity not allowed in JSON" if f.infinite?
    f.to_s
  end

  def self.key_string(k)
    k.is_a?(String) ? k : k.to_s
  end

  def self.gen_string(s)
    out = "\""
    s.each_char do |c|
      o = c.ord
      if o == 34
        out << "\\\""
      elsif o == 92
        out << "\\\\"
      elsif o >= 32
        out << c
      elsif o == 8
        out << "\\b"
      elsif o == 9
        out << "\\t"
      elsif o == 10
        out << "\\n"
      elsif o == 12
        out << "\\f"
      elsif o == 13
        out << "\\r"
      else
        out << "\\u" << ("%04x" % o)
      end
    end
    out << "\""
    out
  end

  def self.pretty_value(obj, depth)
    if obj.is_a?(Array)
      return "[]" if obj.empty?
      inner = obj.map { |e| indent(depth + 1) + pretty_value(e, depth + 1) }
      "[\n" + inner.join(",\n") + "\n" + indent(depth) + "]"
    elsif obj.is_a?(Hash)
      return "{}" if obj.empty?
      inner = obj.map do |k, v|
        indent(depth + 1) + gen_string(key_string(k)) + ": " + pretty_value(v, depth + 1)
      end
      "{\n" + inner.join(",\n") + "\n" + indent(depth) + "}"
    else
      gen_value(obj)
    end
  end

  def self.indent(n)
    "  " * n
  end

  class Parser
    def initialize(str, symbolize_names)
      # Index a chars array, not the string: v8ruby's String#[] is UTF-16
      # unit based while #length counts characters, which breaks on
      # astral-plane characters. chars is consistently character based.
      @s = str.chars
      @len = @s.length
      @pos = 0
      @sym = symbolize_names
    end

    def run
      skip_ws
      v = parse_value
      skip_ws
      fail_at("unexpected trailing content") if @pos < @len
      v
    end

    def fail_at(msg)
      raise ParserError, "#{msg} at position #{@pos}"
    end

    def skip_ws
      while @pos < @len
        c = @s[@pos]
        break unless c == " " || c == "\t" || c == "\n" || c == "\r"
        @pos += 1
      end
    end

    def parse_value
      fail_at("unexpected end of input") if @pos >= @len
      c = @s[@pos]
      if c == "{"
        parse_object
      elsif c == "["
        parse_array
      elsif c == "\""
        parse_string
      elsif c == "t"
        expect_word("true", true)
      elsif c == "f"
        expect_word("false", false)
      elsif c == "n"
        expect_word("null", nil)
      elsif c == "-" || (c >= "0" && c <= "9")
        parse_number
      else
        fail_at("unexpected token '#{c}'")
      end
    end

    def expect_word(word, value)
      slice = @s[@pos, word.length]
      fail_at("invalid literal") unless slice && slice.join == word
      @pos += word.length
      value
    end

    def parse_object
      @pos += 1
      h = {}
      skip_ws
      if @s[@pos] == "}"
        @pos += 1
        return h
      end
      loop do
        skip_ws
        fail_at("expected object key") unless @s[@pos] == "\""
        key = parse_string
        key = key.to_sym if @sym
        skip_ws
        fail_at("expected ':' in object") unless @s[@pos] == ":"
        @pos += 1
        skip_ws
        h[key] = parse_value
        skip_ws
        c = @s[@pos]
        if c == ","
          @pos += 1
        elsif c == "}"
          @pos += 1
          break
        else
          fail_at("expected ',' or '}' in object")
        end
      end
      h
    end

    def parse_array
      @pos += 1
      a = []
      skip_ws
      if @s[@pos] == "]"
        @pos += 1
        return a
      end
      loop do
        skip_ws
        a << parse_value
        skip_ws
        c = @s[@pos]
        if c == ","
          @pos += 1
        elsif c == "]"
          @pos += 1
          break
        else
          fail_at("expected ',' or ']' in array")
        end
      end
      a
    end

    def parse_string
      @pos += 1
      out = ""
      loop do
        fail_at("unterminated string") if @pos >= @len
        c = @s[@pos]
        if c == "\""
          @pos += 1
          return out
        elsif c == "\\"
          e = @s[@pos + 1]
          fail_at("unterminated escape") if e.nil?
          if e == "\""
            out << "\""
            @pos += 2
          elsif e == "\\"
            out << "\\"
            @pos += 2
          elsif e == "/"
            out << "/"
            @pos += 2
          elsif e == "b"
            out << "\b"
            @pos += 2
          elsif e == "f"
            out << "\f"
            @pos += 2
          elsif e == "n"
            out << "\n"
            @pos += 2
          elsif e == "r"
            out << "\r"
            @pos += 2
          elsif e == "t"
            out << "\t"
            @pos += 2
          elsif e == "u"
            hex = (@s[@pos + 2, 4] || []).join
            unless hex.length == 4 && hex =~ /\A[0-9a-fA-F]{4}\z/
              fail_at("invalid unicode escape")
            end
            # v8ruby strings are JS (UTF-16) strings: appending each \uXXXX
            # unit combines surrogate pairs into the right character.
            out << hex.to_i(16)
            @pos += 6
          else
            # MRI's parser is lenient with unknown escapes: it drops the
            # backslash and keeps the following character (e.g. "\x" => "x").
            out << e
            @pos += 2
          end
        else
          fail_at("raw control character in string") if c.ord < 32
          out << c
          @pos += 1
        end
      end
    end

    def parse_number
      start = @pos
      @pos += 1 if @s[@pos] == "-"
      fail_at("invalid number") unless digit?(@s[@pos])
      if @s[@pos] == "0"
        @pos += 1
        fail_at("leading zero in number") if digit?(@s[@pos])
      else
        @pos += 1 while digit?(@s[@pos])
      end
      is_float = false
      if @s[@pos] == "."
        is_float = true
        @pos += 1
        fail_at("expected digit after '.'") unless digit?(@s[@pos])
        @pos += 1 while digit?(@s[@pos])
      end
      if @s[@pos] == "e" || @s[@pos] == "E"
        is_float = true
        @pos += 1
        @pos += 1 if @s[@pos] == "+" || @s[@pos] == "-"
        fail_at("expected digit in exponent") unless digit?(@s[@pos])
        @pos += 1 while digit?(@s[@pos])
      end
      text = @s[start, @pos - start].join
      is_float ? text.to_f : text.to_i
    end

    def digit?(c)
      !c.nil? && c >= "0" && c <= "9"
    end
  end
end

class Object
  def to_json(*rest)
    JSON.generate(to_s)
  end
end

class NilClass
  def to_json(*rest)
    "null"
  end
end

class TrueClass
  def to_json(*rest)
    "true"
  end
end

class FalseClass
  def to_json(*rest)
    "false"
  end
end

class Integer
  def to_json(*rest)
    JSON.generate(self)
  end
end

class Float
  def to_json(*rest)
    JSON.generate(self)
  end
end

class String
  def to_json(*rest)
    JSON.generate(self)
  end
end

class Symbol
  def to_json(*rest)
    JSON.generate(self)
  end
end

class Array
  def to_json(*rest)
    JSON.generate(self)
  end
end

class Hash
  def to_json(*rest)
    JSON.generate(self)
  end
end
