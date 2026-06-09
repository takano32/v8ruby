# Pathname for v8ruby: an object-oriented wrapper over File/Dir class methods.

class Pathname
  include Comparable

  def initialize(path)
    @path = path.to_s
  end

  def to_s = @path
  def to_path = @path

  def +(other)
    o = other.to_s
    return Pathname.new(o) if o.start_with?("/")
    Pathname.new(@path == "" ? o : File.join(@path, o))
  end
  def /(other) = self + other

  def join(*parts)
    result = self
    parts.each { |p| result = result + p }
    result
  end

  def dirname = Pathname.new(File.dirname(@path))
  def parent = dirname
  def basename(*args) = Pathname.new(File.basename(@path, *args))
  def extname = File.extname(@path)
  def sub_ext(ext) = Pathname.new(@path.sub(/#{Regexp.escape(extname)}\z/, ext))

  def exist? = File.exist?(@path)
  def file? = File.file?(@path)
  def directory? = File.directory?(@path)
  def absolute? = @path.start_with?("/")
  def relative? = !absolute?

  def expand_path(base = Dir.pwd) = Pathname.new(File.expand_path(@path, base.to_s))
  def realpath = Pathname.new(File.realpath(@path))
  def cleanpath
    parts = []
    @path.split("/").each do |seg|
      next if seg == "" || seg == "."
      if seg == ".." && !parts.empty? && parts.last != ".."
        parts.pop
      else
        parts.push(seg)
      end
    end
    Pathname.new((absolute? ? "/" : "") + parts.join("/"))
  end

  def read = File.read(@path)
  def write(content) = File.write(@path, content)
  def readlines = File.readlines(@path)
  def delete = File.delete(@path)
  def size = File.size(@path)

  def children
    Dir.children(@path).sort.map { |c| Pathname.new(File.join(@path, c)) }
  end

  def entries
    Dir.entries(@path).sort.map { |c| Pathname.new(c) }
  end

  def glob(pattern)
    Dir.glob(File.join(@path, pattern)).sort.map { |c| Pathname.new(c) }
  end

  def each_filename(&blk)
    parts = @path.split("/").reject { |s| s.empty? }
    parts.each(&blk)
  end

  def mkpath
    parts = @path.split("/").reject { |s| s.empty? }
    cur = absolute? ? "/" : ""
    parts.each do |seg|
      cur = cur == "" ? seg : (cur == "/" ? "/" + seg : File.join(cur, seg))
      Dir.mkdir(cur) unless Dir.exist?(cur)
    end
    nil
  end
  def mkdir = Dir.mkdir(@path)

  def ==(other) = other.is_a?(Pathname) && @path == other.to_s
  def eql?(other) = self == other
  def <=>(other) = @path <=> other.to_s
  def hash = @path.hash
  def inspect = "#<Pathname:#{@path}>"
  def freeze
    @path.freeze
    super
  end

  def relative_path_from(base)
    from = base.to_s.split("/").reject { |s| s.empty? }
    to = @path.split("/").reject { |s| s.empty? }
    i = 0
    i += 1 while i < from.size && i < to.size && from[i] == to[i]
    ups = [".."] * (from.size - i)
    Pathname.new((ups + to[i..]).join("/"))
  end

  def self.pwd = Pathname.new(Dir.pwd)
  def self.getwd = pwd
end

module Kernel
  def Pathname(path) = Pathname.new(path)
end

# Kernel methods live on Object in v8ruby.
def Pathname(path) = Pathname.new(path)
