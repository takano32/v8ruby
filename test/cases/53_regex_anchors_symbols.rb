# Ruby ^ and $ are line-anchored (like JS /m); \A and \z are string anchors
puts "a\nb\nc".scan(/^./).inspect
puts "a\nb\nc".scan(/.$/).inspect
puts "line1\nline2".gsub(/^/, "> ")
puts(/\Afoo/ =~ "foo\nbar")
puts(/\Abar/ =~ "foo\nbar").inspect
puts(/bar\z/ =~ "foo\nbar")
puts(/foo\z/ =~ "foo\nbar").inspect

# blockquote-style prefix stripping with multiline ^
text = "> quote line one\n> quote line two\n"
puts text.gsub(/^> ?/, "")

# atomic groups (?>...) and possessive quantifiers compile and match
puts(/(?>a+)b/ =~ "aaab")
puts("aaab" =~ /a++b/)
puts("xxxy".gsub(/x*+/, "Z"))

# dynamic (interpolated) symbols
k = "header"
puts(:"convert_#{k}".inspect)
dispatch = Hash.new { |h, key| h[key] = :"handle_#{key}" }
puts dispatch[:click].inspect
puts dispatch[:hover].inspect

# :'single' symbols
puts :'with spaces'.inspect

# keyword as hash label
opts = {class: "btn", if: true, do: 1, end: 2}
puts opts[:class]
puts opts[:if]
puts opts[:end]

# tr with negated set ^
puts "Hello, World! 123".tr('^a-zA-Z0-9 -', '')
s = "Keep123Only"
s.tr!('^0-9', '')
puts s

# in-place string mutators
str = "  padded  "
str.rstrip!
puts str.inspect
str.lstrip!
puts str.inspect
