s = "hello".freeze
begin; s << " world"; rescue FrozenError => e; puts e.message; end
begin; s.upcase!; rescue FrozenError => e; puts e.message; end
begin; s.gsub!(/h/, 'H'); rescue FrozenError => e; puts e.message; end
begin; s.replace("other"); rescue FrozenError => e; puts e.message; end

a = [1, 2, 3].freeze
begin; a.push(4); rescue FrozenError => e; puts e.message; end
begin; a << 5; rescue FrozenError => e; puts e.message; end
begin; a.pop; rescue FrozenError => e; puts e.message; end
begin; a.shift; rescue FrozenError => e; puts e.message; end
begin; a[0] = 9; rescue FrozenError => e; puts e.message; end
begin; a.clear; rescue FrozenError => e; puts e.message; end

h = {a: 1, b: 2}.freeze
begin; h[:c] = 3; rescue FrozenError => e; puts e.message; end
begin; h.delete(:a); rescue FrozenError => e; puts e.message; end
begin; h.merge!(x: 9); rescue FrozenError => e; puts e.message; end
begin; h.clear; rescue FrozenError => e; puts e.message; end
