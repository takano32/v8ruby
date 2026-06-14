# Rational and Complex literals, arithmetic, coercion, and formatting.

puts "== rational literals =="
p 2r
p 1/2r
p 3.5r
p((1/2r).class)

puts "== rational arithmetic =="
p((1/2r) + (1/3r))
p((1/2r) - (1/3r))
p((2/3r) * (3/4r))
p((1/2r) / (1/4r))
p((3/4r) ** 2)
p((3/4r) ** -1)
p(-(1/2r))
p((1/2r).abs)

puts "== rational / integer / float mixing =="
p(2 + (1/2r))
p((1/2r) + 2)
p((1/2r) + 0.5)
p(1.5 + (1/2r))
p(2 == (4/2r))
p((2/4r) == (1/2r))
p((1/2r) <=> (1/3r))

puts "== rational conversions =="
p((7/2r).to_f)
p((7/2r).to_i)
p((1/2r).numerator)
p((1/2r).denominator)
p(Rational(3, 4))
p(Rational(6, 8))
p(Rational("3/4"))
p(10.to_r)
p(3.14.to_r)
p(0.5.to_r)
p(3.14.rationalize)
p(0.5.rationalize)
p((1/3r).to_s)
p((1/3r).inspect)

puts "== complex literals / arithmetic =="
p 1i
p((1+2i))
p((1+2i).class)
p((1+2i) + (3+4i))
p((1+2i) - (3+4i))
p((1+2i) * (3+4i))
p((1+2i) / (1-1i))
p(1i * 1i)
p(-(1+2i))

puts "== complex parts / helpers =="
p((3+4i).abs)
p((1+2i).conjugate)
p((1+2i).real)
p((1+2i).imaginary)
p((1+2i).abs2)
p(Complex(3, 4))
p(Complex(2))
p((1+0i) == 1)
p((1+2i) == Complex(1, 2))

puts "== complex formatting =="
p(Complex(2, 4).to_s)
p(Complex(2, -4).to_s)
p(Complex(Rational(-1, 2), Rational(3, 2)).to_s)
p(Complex(1.0, 2.0).to_s)
puts Complex(2, 4)
puts Rational(3, 4)
