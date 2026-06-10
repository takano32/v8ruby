puts "hello" =~ /[[:alpha:]]+/ ? "alpha" : "no"
puts "123" =~ /[[:digit:]]+/ ? "digit" : "no"
puts "  " =~ /[[:space:]]+/ ? "space" : "no"
puts "HELLO" =~ /[[:upper:]]+/ ? "upper" : "no"
puts "hello" =~ /[[:lower:]]+/ ? "lower" : "no"
puts "abc123" =~ /[[:alnum:]]+/ ? "alnum" : "no"
puts "hello!".gsub(/[[:punct:]]/, ".")
puts "0xFF" =~ /[[:xdigit:]]+/ ? "xdigit" : "no"
puts "hello world".scan(/[[:alpha:]]+/).inspect
