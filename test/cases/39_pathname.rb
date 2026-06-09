require "pathname"

p1 = Pathname.new("/usr/lib/ruby")
puts p1.to_s
puts (p1 + "gems").to_s
puts (p1 / "gems" / "x.rb").to_s
puts p1.join("a", "b").to_s
puts p1.dirname.to_s
puts p1.basename.to_s
puts Pathname.new("/x/y/file.tar.gz").extname
puts Pathname.new("/x/y/file.rb").basename(".rb").to_s
puts p1.absolute?
puts Pathname.new("rel/path").relative?
puts Pathname.new("/a/b/../c/./d").cleanpath.to_s
puts Pathname.new("a/b/../../x").cleanpath.to_s
puts (Pathname.new("/a/b") == Pathname.new("/a/b"))
puts (Pathname.new("/a/a") <=> Pathname.new("/a/b"))
puts Pathname.new("/a/b/c/d").relative_path_from(Pathname.new("/a/b")).to_s
puts Pathname.new("/a/x").relative_path_from(Pathname.new("/a/b/c")).to_s
puts Pathname("via_kernel").to_s
puts p1.inspect
names = []
Pathname.new("/usr/local/bin").each_filename { |f| names << f }
p names
puts Pathname.new("/x/file.rb").sub_ext(".txt").to_s
