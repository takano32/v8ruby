# Pure-Ruby shellwords shim for v8ruby, modeled on ruby/shellwords 0.2.2.
# shellsplit is a hand-written parser (MRI's \G / atomic-group scan regex is
# not expressible on v8ruby's JS-backed regexes) that reproduces MRI's
# tokenization and error messages exactly.
module Shellwords
  VERSION = "0.2.2"

  # Ruby's regex \s (NOT JS \s, which also matches NBSP etc.)
  WHITESPACE_CHARS = " \t\r\n\f\v"

  def shellsplit(line)
    words = []
    field = +""
    len = line.length
    i = 0
    while i < len
      mstart = i # match start, including leading whitespace ($~.begin(0) in MRI)
      i += 1 while i < len && WHITESPACE_CHARS.include?(line[i])
      break if i >= len
      c = line[i]
      if c == "'"
        j = i + 1
        j += 1 while j < len && line[j] != "'" && line[j] != "\0"
        shellsplit_garbage(line, mstart, i) unless j < len && line[j] == "'"
        field << line[i + 1, j - i - 1]
        i = j + 1
      elsif c == "\""
        j = i + 1
        closed = false
        while j < len
          cj = line[j]
          if cj == "\""
            closed = true
            break
          elsif cj == "\\"
            break if j + 1 >= len || line[j + 1] == "\0"
            j += 2
          elsif cj == "\0"
            break
          else
            j += 1
          end
        end
        shellsplit_garbage(line, mstart, i) unless closed
        # POSIX 2.2.3: backslash is special only before $ ` " \ <newline>
        field << line[i + 1, j - i - 1].gsub(/\\([$`"\\\n])/, '\1')
        i = j + 1
      elsif c == "\\"
        nxt = i + 1 < len ? line[i + 1] : nil
        if nxt.nil? || nxt == "\0"
          field << "\\" # lone trailing backslash is kept
          i += 1
        elsif nxt == "\n"
          field << "\\\n" # MRI unescapes with /\\(.)/ (no /m), so \<LF> survives
          i += 2
        else
          field << nxt
          i += 2
        end
      elsif c == "\0"
        shellsplit_garbage(line, mstart, i)
      else
        j = i
        while j < len
          cj = line[j]
          break if cj == "\\" || cj == "'" || cj == "\"" || cj == "\0" ||
                   WHITESPACE_CHARS.include?(cj)
          j += 1
        end
        field << line[i, j - i]
        i = j
      end
      # separator: one whitespace char, or end of string
      if i >= len
        words << field
        field = +""
      elsif WHITESPACE_CHARS.include?(line[i])
        i += 1
        words << field
        field = +""
      end
    end
    words
  end

  # Reproduces MRI's error: $~[0] is leading whitespace + offending char
  # (+ one trailing whitespace char if present), prefixed by "..." unless
  # the match starts at position 0.
  def shellsplit_garbage(line, mstart, gi)
    matched = line[mstart, gi - mstart + 1]
    matched += line[gi + 1] if gi + 1 < line.length && WHITESPACE_CHARS.include?(line[gi + 1])
    matched = "..." + matched if mstart > 0
    kind = line[gi] == "\0" ? "Nul character" : "Unmatched quote"
    raise ArgumentError, "#{kind} at #{mstart}: #{matched}"
  end

  def shellescape(str)
    str = str.to_s
    return "''" if str.empty?
    raise ArgumentError, "NUL character" if str.include?("\0")
    str = str.gsub(/[^A-Za-z0-9_\-.,:+\/@\n]/) { |m| "\\" + m }
    # \<LF> is a line continuation, so LF must be single-quoted instead
    str.gsub(/\n/, "'\n'")
  end

  def shelljoin(array)
    array.map { |arg| shellescape(arg) }.join(" ")
  end

  alias shellwords shellsplit
  module_function :shellsplit, :shellwords, :shellsplit_garbage, :shellescape, :shelljoin

  class << self
    alias split shellsplit
    alias escape shellescape
    alias join shelljoin
  end
end

class String
  def shellsplit
    Shellwords.split(self)
  end

  def shellescape
    Shellwords.escape(self)
  end
end

class Array
  def shelljoin
    Shellwords.join(self)
  end
end
