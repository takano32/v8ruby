# Minimal YAML shim for v8ruby.
# Implements the subset most gems use: YAML.load, YAML.safe_load, YAML.dump.
# Full YAML parsing is not attempted; this covers simple key/value configs.

require 'json'

module YAML
  VERSION = "0.1.0 (v8ruby shim)"

  class SyntaxError < StandardError; end

  def self.load(str, **_opts)
    parse_yaml(str.to_s)
  end

  def self.safe_load(str, permitted_classes: [], symbolize_names: false, **_opts)
    result = parse_yaml(str.to_s)
    symbolize_names ? symbolize(result) : result
  end

  def self.load_file(path, **opts)
    load(File.read(path), **opts)
  end

  def self.safe_load_file(path, **opts)
    safe_load(File.read(path), **opts)
  end

  def self.dump(obj, **_opts)
    to_yaml_str(obj) + "\n"
  end

  def self.parse(str)
    # Returns a Psych::Nodes-like object — just return the value directly for compatibility
    parse_yaml(str)
  end

  def self.symbolize(obj)
    case obj
    when Hash
      h = {}
      obj.each { |k, v| h[k.to_sym] = symbolize(v) }
      h
    when Array
      obj.map { |v| symbolize(v) }
    else
      obj
    end
  end

  private_class_method def self.parse_yaml(str)
    lines = str.split("\n")
    parse_lines(lines, 0)[0]
  end

  private_class_method def self.parse_lines(lines, base_indent)
    result = nil
    i = 0
    while i < lines.size
      line = lines[i]
      next_i = i + 1

      stripped = line.lstrip
      indent = line.length - stripped.length

      next (i = next_i) if stripped.empty? || stripped.start_with?("#")

      break if indent < base_indent

      if stripped.start_with?("- ")
        # sequence item
        result = [] unless result.is_a?(Array)
        val_str = stripped[2..]
        if val_str.strip.empty?
          # block sequence value on next lines
          child_lines = []
          j = next_i
          while j < lines.size
            cl = lines[j]
            cs = cl.lstrip
            ci = cl.length - cs.length
            break if !cs.empty? && ci <= indent
            child_lines << cl
            j += 1
          end
          result << parse_lines(child_lines, indent + 2)[0]
          next_i = j
        else
          result << parse_scalar(val_str.strip)
        end
      elsif (m = stripped.match(/\A([^:]+):\s*(.*)\z/))
        key, val = m[1].strip, m[2].strip
        result = {} unless result.is_a?(Hash)
        if val.empty? || val == "|" || val == ">"
          # block mapping value
          child_lines = []
          j = next_i
          while j < lines.size
            cl = lines[j]
            cs = cl.lstrip
            ci = cl.length - cs.length
            break if !cs.empty? && ci <= indent
            child_lines << cl
            j += 1
          end
          if val == "|"
            result[key] = child_lines.map { |l| l.sub(" " * (indent + 2), "") }.join("\n") + "\n"
          elsif val == ">"
            result[key] = child_lines.map { |l| l.strip }.join(" ") + "\n"
          else
            result[key] = parse_lines(child_lines, indent + 2)[0]
          end
          next_i = j
        else
          result[key] = parse_scalar(val)
        end
      end

      i = next_i
    end
    [result, i]
  end

  private_class_method def self.parse_scalar(s)
    return nil if s == "~" || s == "null"
    return true if s == "true"
    return false if s == "false"
    return s.to_i if s =~ /\A-?\d+\z/
    return s.to_f if s =~ /\A-?\d+\.\d+\z/
    if (s.start_with?('"') && s.end_with?('"')) || (s.start_with?("'") && s.end_with?("'"))
      return s[1..-2]
    end
    s
  end

  private_class_method def self.to_yaml_str(obj, indent = 0)
    pad = " " * indent
    case obj
    when Hash
      return "{}" if obj.empty?
      obj.map { |k, v|
        ks = k.to_s
        vs = to_yaml_str(v, indent + 2)
        if vs.include?("\n")
          "#{pad}#{ks}:\n#{vs}"
        else
          "#{pad}#{ks}: #{vs}"
        end
      }.join("\n")
    when Array
      return "[]" if obj.empty?
      obj.map { |v| "#{pad}- #{to_yaml_str(v, indent + 2)}" }.join("\n")
    when true then "true"
    when false then "false"
    when nil then "~"
    when Integer, Float then obj.to_s
    when String
      if obj =~ /[:\[\]{},#&*!|>'"%@`\n]/ || obj.strip != obj
        obj.inspect
      else
        obj
      end
    else
      obj.to_s
    end
  end
end

Psych = YAML
