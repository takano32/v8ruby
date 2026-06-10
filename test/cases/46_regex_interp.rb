# Regexp#to_s with proper flag rendering
puts(/foo/i.to_s)
puts(/bar/m.to_s)
puts(/baz/.to_s)
puts(/qux/ix.to_s)

# interpolating a Regexp into another regex
vs = /\{\{/
ve = /\}\}/
r = /\A#{vs}\s*(.*?)\s*#{ve}\z/m
m = "{{ name }}".match(r)
puts m[1]

# interpolating a Regexp into a string
puts "pattern: #{/abc/i}"

# bare raise re-raises the current exception ($!)
begin
  begin
    raise ArgumentError, "original error"
  rescue => e
    raise
  end
rescue => e2
  puts "#{e2.class}: #{e2.message}"
end

# $! is nil outside any rescue
puts $!.inspect

# nested rescue restores outer $!
begin
  raise "outer"
rescue
  begin
    raise "inner"
  rescue
    puts $!.message
  end
  puts $!.message
end
