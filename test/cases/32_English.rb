require "English"

# Only at-rest values are printed: v8ruby's English shim takes static
# snapshots, so dynamic tracking (e.g. $MATCH after a regexp) is out.

puts "-- program --"
puts $PROGRAM_NAME.class

puts "-- field separators --"
p $FS
p $FIELD_SEPARATOR
p $OFS
p $OUTPUT_FIELD_SEPARATOR

puts "-- record separators --"
p $RS
p $INPUT_RECORD_SEPARATOR
p $ORS
p $OUTPUT_RECORD_SEPARATOR

puts "-- input state --"
p $INPUT_LINE_NUMBER
p $NR
p $LAST_READ_LINE

puts "-- error state --"
p $ERROR_INFO
p $ERROR_POSITION

puts "-- match state --"
p $LAST_MATCH_INFO
p $MATCH
p $PREMATCH
p $POSTMATCH
p $LAST_PAREN_MATCH

puts "-- process --"
puts $PID.class
puts $PROCESS_ID.class
puts $PID == Process.pid
puts $PID == $PROCESS_ID
p $CHILD_STATUS

puts "-- argv and io --"
p $ARGV
puts $ARGV == ARGV
puts $DEFAULT_OUTPUT.class
puts $DEFAULT_OUTPUT == $stdout

puts "-- record separator in use --"
line = "alpha" + $RS + "beta" + $RS
p line.split($RS)
$DEFAULT_OUTPUT.write("written via DEFAULT_OUTPUT", $RS)

puts "-- done --"
