# Count word frequencies and print a sorted report.
text = <<~TEXT
  the quick brown fox jumps over the lazy dog
  the dog barks and the fox runs
TEXT

counts = Hash.new(0)
text.split.each { |w| counts[w] += 1 }

counts.sort_by { |word, n| [-n, word] }.each do |word, n|
  puts "#{word.ljust(8)} #{n}"
end
