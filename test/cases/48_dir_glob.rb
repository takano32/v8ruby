# Build a small tree including a hidden directory that the glob must traverse.
tmp = ENV['TMPDIR'] || '/tmp'
base = File.join(tmp, "v8ruby_glob_#{Process.pid}")
Dir.mkdir(base) unless Dir.exist?(base)
Dir.mkdir(File.join(base, ".hidden")) unless Dir.exist?(File.join(base, ".hidden"))
Dir.mkdir(File.join(base, "sub")) unless Dir.exist?(File.join(base, "sub"))
File.write(File.join(base, ".hidden", "a.rb"), "")
File.write(File.join(base, ".hidden", "b.rb"), "")
File.write(File.join(base, "sub", "c.rb"), "")
File.write(File.join(base, "sub", "d.txt"), "")
File.write(File.join(base, "top.rb"), "")

# explicitly-named hidden dir is traversed
puts Dir["#{base}/.hidden/*.rb"].sort.map { |f| File.basename(f) }.inspect
# wildcard skips dotfiles but matches normal ones
puts Dir["#{base}/*.rb"].sort.map { |f| File.basename(f) }.inspect
# only .rb in sub
puts Dir["#{base}/sub/*.rb"].sort.map { |f| File.basename(f) }.inspect
# recursive ** glob
puts Dir["#{base}/**/*.rb"].sort.map { |f| File.basename(f) }.inspect

# cleanup
[".hidden/a.rb", ".hidden/b.rb", "sub/c.rb", "sub/d.txt", "top.rb"].each { |f| File.delete(File.join(base, f)) }
Dir.delete(File.join(base, ".hidden"))
Dir.delete(File.join(base, "sub"))
Dir.delete(base)
