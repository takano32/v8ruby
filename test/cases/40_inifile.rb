require 'inifile'

content = "[s1]\nkey1 = val1\nkey2 = val2\n\n[s2]\nfoo = bar\n"
File.write('/tmp/_v8ruby_inifile_test.ini', content)
ini = IniFile.load('/tmp/_v8ruby_inifile_test.ini')
puts ini['s1']['key1']
puts ini['s1']['key2']
puts ini['s2']['foo']
File.delete('/tmp/_v8ruby_inifile_test.ini')
