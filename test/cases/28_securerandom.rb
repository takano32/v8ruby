require "securerandom"

# --- hex ---
h = SecureRandom.hex
puts h.length
puts h.match?(/\A[0-9a-f]{32}\z/)
puts SecureRandom.hex(4).length
puts SecureRandom.hex(4).match?(/\A[0-9a-f]{8}\z/)
puts SecureRandom.hex(0).empty?
puts SecureRandom.hex != SecureRandom.hex

# --- uuid ---
u = SecureRandom.uuid
puts u.length
puts u.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/)
puts u[14]
puts %w[8 9 a b].include?(u[19])
puts SecureRandom.uuid != SecureRandom.uuid

# version/variant nibbles must hold across many draws
shape_ok = true
50.times do
  x = SecureRandom.uuid
  shape_ok &&= x[14] == "4" && %w[8 9 a b].include?(x[19])
end
puts shape_ok

# --- alphanumeric ---
a = SecureRandom.alphanumeric
puts a.length
puts a.match?(/\A[A-Za-z0-9]+\z/)
puts SecureRandom.alphanumeric(40).length
puts SecureRandom.alphanumeric != SecureRandom.alphanumeric

# --- random_number ---
int_ok = true
100.times do
  v = SecureRandom.random_number(10)
  int_ok &&= v.is_a?(Integer) && v >= 0 && v < 10
end
puts int_ok

big_ok = true
20.times do
  v = SecureRandom.random_number(1_000_000_000)
  big_ok &&= v.is_a?(Integer) && v >= 0 && v < 1_000_000_000
end
puts big_ok

float_ok = true
100.times do
  f = SecureRandom.random_number
  float_ok &&= f.is_a?(Float) && f >= 0.0 && f < 1.0
end
puts float_ok

fa = SecureRandom.random_number(2.5)
puts fa.class
puts fa >= 0.0 && fa < 2.5

# --- random_bytes / bytes (lengths only; content is binary) ---
puts SecureRandom.random_bytes.length
puts SecureRandom.random_bytes(5).length
puts SecureRandom.bytes(8).length

# --- base64 ---
b = SecureRandom.base64
puts b.length
puts b.end_with?("==")
puts b.match?(/\A[A-Za-z0-9+\/=]+\z/)
puts SecureRandom.base64(9).length
puts SecureRandom.base64(9).include?("=")

# --- urlsafe_base64 ---
ub = SecureRandom.urlsafe_base64
puts ub.length
puts ub.match?(/\A[A-Za-z0-9_-]+\z/)
puts SecureRandom.urlsafe_base64(12).length
puts SecureRandom.urlsafe_base64(16, true).length
puts SecureRandom.urlsafe_base64(16, true).end_with?("==")
puts SecureRandom.urlsafe_base64 != SecureRandom.urlsafe_base64
