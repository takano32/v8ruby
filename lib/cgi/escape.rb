# In MRI cgi/escape is a C extension providing CGI.escape* fast paths.
# Our pure-Ruby cgi shim already defines those methods, so just load it.
require 'cgi'
