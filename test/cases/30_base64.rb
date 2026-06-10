require "base64"

puts "== known vectors =="
p Base64.encode64("hello")
p Base64.strict_encode64("hello")
p Base64.encode64("Many hands make light work.")
p Base64.strict_encode64("Many hands make light work.")

puts "== empty and 1/2/3-byte remainders =="
p Base64.encode64("")
p Base64.strict_encode64("")
p Base64.encode64("a")
p Base64.encode64("ab")
p Base64.encode64("abc")
p Base64.encode64("abcd")
p Base64.strict_encode64("a")
p Base64.strict_encode64("ab")
p Base64.strict_encode64("abc")
p Base64.strict_encode64("abcd")

puts "== line wrapping on long input =="
p Base64.encode64("x" * 100)
p Base64.encode64("x" * 61)
long = "The quick brown fox jumps over the lazy dog. " * 4
p Base64.encode64(long)
p Base64.strict_encode64(long).length
p Base64.encode64(long).count("\n")

puts "== multibyte input (encoded byte-wise) =="
p Base64.strict_encode64("héllo")
p Base64.encode64("\u{1F600}")

puts "== urlsafe =="
p Base64.urlsafe_encode64("ab>ab?ab>")
p Base64.strict_encode64("ab>ab?ab>")
p Base64.urlsafe_encode64("a")
p Base64.urlsafe_encode64("a", padding: false)
p Base64.urlsafe_encode64("ab", padding: false)
p Base64.urlsafe_encode64("abc", padding: false)
p Base64.urlsafe_encode64("")

puts "== lenient decode64 =="
p Base64.decode64("")
p Base64.decode64("aGVsbG8=")
p Base64.decode64("aGVsbG8=\n")
p Base64.decode64("aGVs\nbG8=")
p Base64.decode64("aGVs bG8=!!!")
p Base64.decode64("aGVsbG8")
p Base64.decode64("YQ")
p Base64.decode64("YQ=")
p Base64.decode64("a")
p Base64.decode64("====")
p Base64.decode64("=YQ==")
p Base64.decode64("YQ==YWI=")
p Base64.decode64("Y=Q=")
p Base64.decode64("YWJj=YWJj")
p Base64.decode64("YW=Jj")
p Base64.decode64("YR==")
p Base64.decode64("YWI+YWI/")
p Base64.decode64("aGVsbG8=aGVsbG8=")

puts "== strict_decode64 =="
p Base64.strict_decode64("")
p Base64.strict_decode64("aGVsbG8=")
p Base64.strict_decode64("YWJj")
p Base64.strict_decode64("YQ==")
p Base64.strict_decode64("YWI=")
p Base64.strict_decode64("YWI+YWI/")
["aGVs bG8=", "aGVsbG8", "YQ=", "YR==", "YWJ=", "====", "YQ==YWI=", "aGVsbG8=\n"].each do |bad|
  begin
    Base64.strict_decode64(bad)
    puts "no error for #{bad.inspect}"
  rescue ArgumentError => e
    puts "#{e.class}: #{e.message} for #{bad.inspect}"
  end
end

puts "== urlsafe_decode64 =="
p Base64.urlsafe_decode64("")
p Base64.urlsafe_decode64("aGk=")
p Base64.urlsafe_decode64("aGk")
p Base64.urlsafe_decode64("YWI-YWI_")
p Base64.urlsafe_decode64("YQ")

puts "== round trips =="
["", "a", "ab", "abc", "hello world", "The quick brown fox!", "x" * 75].each do |s|
  puts Base64.decode64(Base64.encode64(s)) == s
  puts Base64.strict_decode64(Base64.strict_encode64(s)) == s
  puts Base64.urlsafe_decode64(Base64.urlsafe_encode64(s)) == s
  puts Base64.urlsafe_decode64(Base64.urlsafe_encode64(s, padding: false)) == s
end
utf8 = "héllo wörld \u{1F600}"
decoded = Base64.strict_decode64(Base64.strict_encode64(utf8))
puts decoded
puts decoded.bytes == utf8.bytes
