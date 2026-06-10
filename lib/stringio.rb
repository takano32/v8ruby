# Pure-Ruby StringIO shim for v8ruby. Implements the common read/write/iterate
# API used by gems (kramdown, etc.). Backed by a plain String buffer.

class StringIO
  attr_accessor :string

  def initialize(string = "", mode = "r")
    @string = string.dup
    @pos = 0
    @mode = mode
    @string = "" if mode.to_s.start_with?("w")
  end

  def self.open(string = "", mode = "r")
    io = new(string, mode)
    return io unless block_given?
    begin
      yield io
    ensure
      io.close
    end
  end

  def read(length = nil, outbuf = nil)
    if length.nil?
      result = @string[@pos..-1] || ""
      @pos = @string.length
      result = result.dup
      outbuf.replace(result) if outbuf
      return result
    end
    return nil if @pos >= @string.length
    result = @string[@pos, length] || ""
    @pos += result.length
    outbuf.replace(result) if outbuf
    result
  end

  def gets(sep = "\n")
    return nil if @pos >= @string.length
    idx = @string.index(sep, @pos)
    if idx
      line = @string[@pos..idx + sep.length - 1]
      @pos = idx + sep.length
    else
      line = @string[@pos..-1]
      @pos = @string.length
    end
    @lineno = (@lineno || 0) + 1
    line
  end

  def each_line(sep = "\n")
    return enum_for(:each_line, sep) unless block_given?
    while (line = gets(sep))
      yield line
    end
    self
  end
  alias each each_line

  def readlines(sep = "\n")
    lines = []
    while (line = gets(sep))
      lines << line
    end
    lines
  end

  def readline(sep = "\n")
    line = gets(sep)
    raise EOFError, "end of file reached" if line.nil?
    line
  end

  def each_char
    return enum_for(:each_char) unless block_given?
    while @pos < @string.length
      yield @string[@pos]
      @pos += 1
    end
    self
  end

  def getc
    return nil if @pos >= @string.length
    c = @string[@pos]
    @pos += 1
    c
  end

  def write(*args)
    n = 0
    args.each do |arg|
      s = arg.to_s
      @string << s
      n += s.length
    end
    n
  end

  def <<(obj)
    @string << obj.to_s
    self
  end

  def print(*args)
    args.each { |a| @string << a.to_s }
    nil
  end

  def printf(format, *args)
    @string << format(format, *args)
    nil
  end

  def puts(*args)
    if args.empty?
      @string << "\n"
    else
      args.each do |a|
        if a.is_a?(Array)
          a.each { |e| puts(e) }
        else
          s = a.to_s
          @string << s
          @string << "\n" unless s.end_with?("\n")
        end
      end
    end
    nil
  end

  def pos
    @pos
  end

  def pos=(n)
    @pos = n
  end

  def rewind
    @pos = 0
    @lineno = 0
    0
  end

  def seek(amount, whence = IO::SEEK_SET)
    case whence
    when IO::SEEK_SET then @pos = amount
    when IO::SEEK_CUR then @pos += amount
    when IO::SEEK_END then @pos = @string.length + amount
    end
    0
  end

  def eof?
    @pos >= @string.length
  end
  alias eof eof?

  def lineno
    @lineno || 0
  end

  def lineno=(n)
    @lineno = n
  end

  def size
    @string.length
  end
  alias length size

  def close
    @closed = true
    nil
  end

  def closed?
    !!@closed
  end

  def flush
    self
  end

  def fsync
    0
  end

  def string
    @string
  end

  def to_s
    @string
  end
end
