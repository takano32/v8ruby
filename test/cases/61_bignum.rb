# Arbitrary-precision integers (Bignum): values promote past Float precision
# and demote back, with exact arithmetic throughout.

puts "== powers and basic arithmetic =="
p 2 ** 100
p 10 ** 20
p 2 ** 64
p((2 ** 64).class)
p 123456789012345678901234567890 + 1
p 1000000000000 * 1000000000000
p((2 ** 100) / (2 ** 50))
p((2 ** 100) % 7)
p 2 ** 100 - 2 ** 100
p((2 ** 100) / (2 ** 50)).class
p((2 ** 64) + 0).class

puts "== factorial / fibonacci =="
def fact(n) = (1..n).reduce(1, :*)
p fact(25)
p fact(50).to_s.length
fib = [0, 1]
100.times { fib << fib[-1] + fib[-2] }
p fib[100]

puts "== conversions and formatting =="
p((2 ** 256).to_s(16))
p((10 ** 30).to_s.length)
p "%d" % (2 ** 70)
p "%x" % (2 ** 64)
p((2 ** 70).to_f.class)
p Integer("123456789012345678901234567890")
p "123456789012345678901234567890".to_i
p 0xffffffffffffffffff

puts "== predicates / bit ops / gcd =="
p((2 ** 100).even?)
p((2 ** 100 + 1).odd?)
p((2 ** 100).bit_length)
p((1 << 70) == 2 ** 70)
p((3 ** 40).gcd(3 ** 20))
p((2 ** 80).lcm(2 ** 40))
p(-(2 ** 70))
p((2 ** 70).abs == 2 ** 70)
p(99999999999999999999 <=> 100000000000000000000)
p((2 ** 100) > (2 ** 99))

puts "== bignum as hash key / in arrays =="
big = 10 ** 40
p({ big => "huge" }[big])
p [big, big].sum
p [big, 1, big].include?(big)
p big.digits.length
