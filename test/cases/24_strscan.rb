require "strscan"

puts "== basic scan =="
s = StringScanner.new("hello world ruby")
p s.scan(/\w+/)
p s.pos
p s.matched
p s.matched?
p s.matched_size
p s.pre_match
p s.post_match
p s.rest
p s.rest_size
p s.eos?
p s.scan(/\w+/)
p s.matched
p s.matched?
p s.pre_match
p s.post_match
p s.skip(/\s+/)
p s.scan(/\w+/)
p s.pre_match
p s.skip(/\s+/)
p s.scan(/\w+/)
p s.eos?
p s.rest
p s.rest_size

puts "== tokenizer =="
s = StringScanner.new("x = 12 + 34*(price - 2)")
tokens = []
until s.eos?
  if s.skip(/\s+/)
    next
  elsif (t = s.scan(/\d+/))
    tokens << [:num, t]
  elsif (t = s.scan(/[a-z_]+/))
    tokens << [:ident, t]
  else
    tokens << [:op, s.getch]
  end
end
p tokens

puts "== captures =="
s = StringScanner.new("Fri Dec 12 1975 14:39")
p s.scan(/(\w+) (\w+) (\d+) /)
p s[0]
p s[1]
p s[2]
p s[3]
p s[4]
p s[-1]
p s[-5]
p s.size
p s.post_match
p s.scan(/(\d+) (\d+):(\d+)/)
p s[0]
p s.size

puts "== named captures =="
s = StringScanner.new("name=alice; age=30")
p s.scan(/(?<key>\w+)=(?<val>\w+)/)
p s[:key]
p s[:val]
p s["key"]
p s[0]
p s[1]
p s[2]
begin
  s[:missing]
rescue IndexError => e
  p e.class
  p e.message
end
s.skip(/; /)
p s.scan(/(?<key>\w+)=(?<val>\w+)/)
p s[:key]
p s[:val]

puts "== scan_until family =="
s = StringScanner.new("foo bar baz bar qux")
p s.scan_until(/bar/)
p s.pre_match
p s.matched
p s.post_match
p s.pos
p s.exist?(/bar/)
p s.pos
p s.matched
p s.check_until(/qux/)
p s.pos
p s.skip_until(/bar/)
p s.pos
p s.scan_until(/zz/)
p s.matched?
p s.pos
p s.skip_until(/zz/)
p s.exist?(/zz/)
p s.check_until(/zz/)

puts "== check and match? =="
s = StringScanner.new("abc def")
p s.check(/\w+/)
p s.pos
p s.matched
p s.match?(/abc/)
p s.pos
p s.match?(/zzz/)
p s.matched?
p s.check(/zzz/)
p s.matched

puts "== getch and peek =="
s = StringScanner.new("xyz")
p s.getch
p s.pos
p s.matched
p s[0]
p s[1]
p s.peek(2)
p s.peek(10)
p s.peek(0)
p s.pos
s.getch
s.getch
p s.getch
p s.eos?
p s.matched?
begin
  s2 = StringScanner.new("abc")
  s2.peek(-1)
rescue ArgumentError => e
  p e.class
  p e.message
end

puts "== unscan reset terminate pos= =="
s = StringScanner.new("foo bar")
s.scan(/foo/)
s.unscan
p s.pos
p s.matched
begin
  s.unscan
rescue StringScanner::Error => e
  p e.class
  p e.message
end
s.scan(/foo/)
s.terminate
p s.pos
p s.eos?
p s.matched
s.reset
p s.pos
p s.matched?
s.pos = 4
p s.rest
s.pos = -3
p s.pos
p s.rest
begin
  s.pos = 100
rescue RangeError => e
  p e.class
  p e.message
end
p s.string
s.reset
s.scan(/foo/)
s.pos = 1
p s.matched
g = StringScanner.new("hi")
g.getch
g.unscan
p g.pos
c = StringScanner.new("ab")
p c.check(/a/)
c.unscan
p c.pos
p c.matched

puts "== string patterns and flags =="
s = StringScanner.new("a.c!")
p s.scan(".")
p s.scan("a")
p s.matched
p s[0]
p s.size
p s.scan(".")
p s.pos
s2 = StringScanner.new("foo bar baz")
p s2.scan_until("bar")
p s2.pos
p s2.matched
s3 = StringScanner.new("HELLO world")
p s3.scan(/hello/i)
p s3.matched

puts "== empty and edge cases =="
s = StringScanner.new("")
p s.eos?
p s.rest
p s.rest_size
p s.getch
p s.scan(//)
s2 = StringScanner.new("aaa")
p s2.scan(/b*/)
p s2.pos
p s2.matched
p s2.scan(/a+/)
p s2.eos?
