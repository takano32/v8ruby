# Raises mid-load; defines a constant first so partial effects are observable.
$raiser_attempts = ($raiser_attempts || 0) + 1
RAISER_PARTIAL = "partial" unless defined?(RAISER_PARTIAL)
raise "boom from raiser"
RAISER_NEVER = "never" unless defined?(RAISER_NEVER)
