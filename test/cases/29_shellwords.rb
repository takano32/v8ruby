require "shellwords"

puts "== split: basic word splitting =="
p Shellwords.split("three blind mice")
p Shellwords.split("  leading   and\ttrailing  ")
p Shellwords.split("")
p Shellwords.split("   ")
p Shellwords.split("one")

puts "== split: quoting forms =="
p Shellwords.split("a b \"c d\" 'e f' g\\ h")
p Shellwords.split("ruby -e 'puts \"hello world\"'")
p Shellwords.split("she said \"hi 'there' friend\"")
p Shellwords.split("'single \"double\" inside'")
p Shellwords.split("con'cat'en\"at\"ed")
p Shellwords.split("''")
p Shellwords.split("\"\"")
p Shellwords.split("a '' b \"\" c")
p Shellwords.split("a''b")

puts "== split: backslash escapes =="
p Shellwords.split("a\\ b c\\\\d e\\'f g\\\"h")
p Shellwords.split("\"dollar \\$HOME tick \\` quote \\\" slash \\\\ other \\n\\x\"")
p Shellwords.split("'no \\$ escapes \\\\ here'")
p Shellwords.split("a\\")
p Shellwords.split("a\\\nb")
p Shellwords.split("\"a\\\nb\"")
p Shellwords.split("'line\nbreak' kept")
p Shellwords.split("tab\there form\ffeed vert\vtab")

puts "== split: unmatched quotes =="
[
  "\"abc",
  "'abc",
  "abc \"def",
  "abc  'def gh",
  "a\" b",
  "it's fine",
  "say \"ab\\\"",
  "\t 'oops",
].each do |bad|
  begin
    p Shellwords.split(bad)
  rescue ArgumentError => e
    puts "#{e.class}: #{e.message}"
  end
end

puts "== escape =="
p Shellwords.escape("")
p Shellwords.escape("simple")
p Shellwords.escape("Safe_chars-1.2,3:+/@end")
p Shellwords.escape("two words")
p Shellwords.escape("it's")
p Shellwords.escape("say \"cheese\"")
p Shellwords.escape("a$b`c\\d")
p Shellwords.escape("*?[]{}()<>|&;~#%^=!")
p Shellwords.escape("\t")
p Shellwords.escape("new\nline")
p Shellwords.escape("multi\nline\ntext\n")
p Shellwords.escape(:symbol)
p Shellwords.escape(42)
p Shellwords.escape("-rf")

puts "== join =="
p Shellwords.join([])
p Shellwords.join(["ls", "-la", "My Documents"])
p Shellwords.join(["There's", "a", "time"])
p Shellwords.join(["a b", "", "c\nd"])
p Shellwords.join(["echo", :hello, 123])

puts "== round trips =="
[
  ["plain", "with space", "it's", "dq\"uote", "back\\slash", ""],
  ["new\nline", "tab\there", "$VAR", "`tick`"],
  ["mixed 'single' and \"double\""],
].each do |argv|
  joined = Shellwords.join(argv)
  p joined
  p Shellwords.split(joined) == argv
end
p Shellwords.split(Shellwords.escape("weird *string* $with `stuff`\n")) == ["weird *string* $with `stuff`\n"]

puts "== aliases and monkeypatches =="
p Shellwords.shellsplit("alias check 'works fine'")
p Shellwords.shellwords("another alias")
p Shellwords.shellescape("a b")
p Shellwords.shelljoin(["x y", "z"])
p "sudo make install".shellsplit
p "don't panic".shellescape
p ["rm", "-r", "Old Files"].shelljoin
begin
  "broken \"quote".shellsplit
rescue ArgumentError => e
  puts "#{e.class}: #{e.message}"
end
