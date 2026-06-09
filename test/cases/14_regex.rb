puts "hello world" =~ /world/
puts("hello world".match?(/\w+/))
p "a1b2c3".scan(/\d/)
p "a1b2c3".scan(/([a-z])(\d)/)
puts "hello".gsub(/l/, "L")
puts "foo bar baz".gsub(/(\w+)/) { |w| w.upcase }
puts "2024-01-15".sub(/(\d+)-(\d+)-(\d+)/, '\3/\2/\1')
p "one two three".split(/\s+/)
puts "Phone: 555-1234" =~ /\d{3}-\d{4}/
m = "John Smith".match(/(?<first>\w+)\s+(?<last>\w+)/)
puts m[:first]
puts m[:last]
puts m[1]
case "hello@example.com"
when /\A\d+\z/ then puts "number"
when /@/ then puts "email"
else puts "other"
end
p "CamelCaseString".scan(/[A-Z][a-z]+/)
puts "  trim  ".gsub(/\s+/, "")
puts "a,b,,c".split(",").inspect
