# English -- English-named aliases for Ruby's punctuation globals.
#
# v8ruby limitation: global variables cannot be aliased, so these are
# plain assignments. Globals whose punctuation counterpart is static at
# program start get MRI's at-rest default; dynamic ones ($ERROR_INFO,
# $LAST_MATCH_INFO, $MATCH, $CHILD_STATUS, ...) are snapshots taken at
# require time and will NOT track later changes the way MRI's do.

# $PROGRAM_NAME ($0) is provided by v8ruby itself; not reassigned here.

# Exception state ($!, $@) -- snapshot, normally nil at require time.
$ERROR_INFO              = $!
$ERROR_POSITION          = nil

# Field separators ($; and $,) -- default nil.
$FS                      = nil
$FIELD_SEPARATOR         = nil
$OFS                     = nil
$OUTPUT_FIELD_SEPARATOR  = nil

# Record separators ($/ and $\).
$RS                      = "\n"
$INPUT_RECORD_SEPARATOR  = "\n"
$ORS                     = nil
$OUTPUT_RECORD_SEPARATOR = nil

# Input bookkeeping ($. and $_).
$INPUT_LINE_NUMBER       = 0
$NR                      = 0
$LAST_READ_LINE          = nil

# Default IO ($> and $<). MRI's $DEFAULT_INPUT is ARGF; v8ruby has no
# ARGF, so $stdin (nil under v8ruby) is the closest available value.
$DEFAULT_OUTPUT          = $stdout
$DEFAULT_INPUT           = $stdin

# Process info ($$ and $?).
$PID                     = Process.pid
$PROCESS_ID              = Process.pid
$CHILD_STATUS            = nil

# Regexp match state ($~, $&, $`, $', $+) -- snapshot only.
$LAST_MATCH_INFO         = $~
$MATCH                   = nil
$PREMATCH                = nil
$POSTMATCH               = nil
$LAST_PAREN_MATCH        = nil

# Command-line arguments ($*).
$ARGV                    = ARGV
