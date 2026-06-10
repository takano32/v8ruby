require "cgi"

puts "-- escape --"
puts CGI.escape("hello world")
puts CGI.escape("a b+c&d=e/f?g#h~i.j-k_l")
puts CGI.escape("*!()',[]@:;")
puts CGI.escape("100% sure\n")
puts CGI.escape("日本語 ok")
puts CGI.escape("emoji \u{1F600}!")
puts CGI.escape("").inspect

puts "-- unescape --"
puts CGI.unescape("a+b%20c")
puts CGI.unescape("%E6%97%A5%E6%9C%AC%E8%AA%9E+ok")
puts CGI.unescape("%e6%97%a5%2fx%2FY")
puts CGI.unescape("%41%42%43%2B%2b")
puts CGI.unescape("%ZZ %2 % end").inspect
puts CGI.unescape("%F0%9F%98%80 four-byte")
puts CGI.unescape("100%25+sure%0A").inspect

puts "-- escapeHTML --"
puts CGI.escapeHTML(%q{<a href="x">&'</a>})
puts CGI.escapeHTML("it's <b>bold</b> & \"quoted\"")
puts CGI.escapeHTML("no specials 123")
puts CGI.h("<&>")

puts "-- unescapeHTML --"
puts CGI.unescapeHTML("&amp;&lt;&gt;&quot;&apos;&#39;")
puts CGI.unescapeHTML("&#65;&#066;&#x4a;&#X4B;")
puts CGI.unescapeHTML("&#x1F600; and &#26085;")
puts CGI.unescapeHTML("&amp;lt; stays &amp;")
puts CGI.unescapeHTML("&bogus; &AMP; &Amp; &amp &#x41 &#; &#x;")
puts CGI.unescapeHTML("&#x110000; &#1114112;")
puts CGI.unescapeHTML("plain text")

puts "-- escapeURIComponent --"
puts CGI.escapeURIComponent("a b+c~d.e-f_g/h")
puts CGI.escapeURIComponent("*!()'")
puts CGI.escapeURIComponent("日 x")
puts CGI.unescapeURIComponent("a+b%20c%2B")
puts CGI.escape_uri_component("a b")
puts CGI.unescape_uri_component("a+b%20c")

puts "-- round trips --"
s = "key=val&x=1 2/3?ok#frag 日本 \u{1F600}"
puts CGI.unescape(CGI.escape(s)) == s
puts CGI.unescapeURIComponent(CGI.escapeURIComponent(s)) == s
puts CGI.escape(s) == CGI.escapeURIComponent(s).gsub("%20", "+")
h = %q{<tag attr="v">&text;'q' <&> "w"</tag>}
puts CGI.unescapeHTML(CGI.escapeHTML(h)) == h
puts CGI.escape_html(h) == CGI.escapeHTML(h)
puts CGI.unescape_html(CGI.escape_html(h)) == h
