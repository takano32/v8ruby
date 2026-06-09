s = "hello world"
puts s.capitalize
puts s.split.map(&:capitalize).join(" ")
puts s.gsub("o", "0")
puts s.sub("l", "L")
puts s.chars.first(3).inspect
puts s.include?("world")
puts s.index("world")
puts s[0..4]
puts s[-5..]
puts s[6, 5]
puts "  trim  ".strip
puts "abc" * 3
puts "a,b,c".split(",").inspect
puts "%05d" % 42
puts "%.2f" % 3.14159
puts "%s is %d" % ["age", 30]
puts "Hello".each_char.to_a.inspect rescue puts "Hello".chars.inspect
puts "racecar" == "racecar".reverse
puts "Ruby".bytes.inspect
n = "42"
puts n.to_i + 8
puts "café".length
puts "tab\tend"
puts "line1\nline2"
