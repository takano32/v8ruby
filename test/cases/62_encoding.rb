# String character sets: Encoding objects/constants, charset-aware bytes and
# unpack, binary (ASCII-8BIT) tagging/inspection, and force_encoding transcode.

puts "== encoding objects =="
p "hello".encoding.to_s
p "hello".encoding.name
p Encoding::UTF_8.to_s
p Encoding::ASCII_8BIT.to_s
p Encoding::BINARY.name
p "hello".encoding == Encoding::UTF_8
p Encoding.default_external.to_s
p "hello".valid_encoding?

puts "== ascii_only? =="
p "hello".ascii_only?
p "café".ascii_only?
p "".ascii_only?

puts "== binary strings (pack / chr) =="
p [255, 0, 65].pack("C*").inspect
p [255, 0, 65].pack("C*").encoding.to_s
p 255.chr
p 255.chr.bytes
p 200.chr.inspect
p 65.chr
p 65.chr.encoding.to_s
p "abc".b.encoding.to_s
p "abc".b.inspect

puts "== encoding-aware bytes / unpack =="
p "café".bytes
p "café".bytesize
p "café".length
p "café".unpack("C*")
p "abc".unpack("C*")
p [104, 105].pack("C*").bytes

puts "== force_encoding transcoding =="
p [195, 169].pack("C*").force_encoding("UTF-8")
p "abc".force_encoding("ASCII-8BIT").encoding.to_s
p "x".encode("UTF-8").encoding.to_s
