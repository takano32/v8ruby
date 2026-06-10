# forwardable.rb -- pure-Ruby shim of MRI's forwardable stdlib for v8ruby.
#
# Provides Forwardable (extend into a class/module to delegate instance
# methods) and SingleForwardable (extend into a single object to delegate
# via its singleton class).
#
# NOTE: v8ruby's define_method never forwards the caller's block to the
# block body (the runtime drops it), so block pass-through through a
# delegated method does not work yet.  The &block parameters below are
# kept so the shim picks the behavior up automatically once the core
# supports it.

module Forwardable
  VERSION = "1.3.3"

  # def_instance_delegator(accessor, method, ali = method)
  #
  # accessor names the delegation target: either an instance variable
  # ("@ivar" / :"@ivar") or a method returning the target object.
  # The delegated method is installed under the name +ali+.
  def def_instance_delegator(accessor, method, ali = method)
    accessor = accessor.to_s
    if accessor.start_with?("@")
      define_method(ali) do |*args, &block|
        instance_variable_get(accessor).send(method, *args, &block)
      end
    else
      define_method(ali) do |*args, &block|
        send(accessor).send(method, *args, &block)
      end
    end
  end

  def def_instance_delegators(accessor, *methods)
    methods.each do |method|
      # MRI refuses to shadow these reserved methods
      next if method == :__send__ || method == :__id__
      def_instance_delegator(accessor, method)
    end
  end

  # instance_delegate(:method => :accessor, [:m1, :m2] => :accessor)
  def instance_delegate(hash)
    hash.each do |methods, accessor|
      methods = [methods] unless methods.is_a?(Array)
      methods.each do |method|
        def_instance_delegator(accessor, method)
      end
    end
  end

  alias delegate instance_delegate
  alias def_delegators def_instance_delegators
  alias def_delegator def_instance_delegator
end

# SingleForwardable is extended into individual objects; delegators are
# installed on the object's singleton class.
module SingleForwardable
  def def_single_delegator(accessor, method, ali = method)
    accessor = accessor.to_s
    if accessor.start_with?("@")
      define_singleton_method(ali) do |*args, &block|
        instance_variable_get(accessor).send(method, *args, &block)
      end
    else
      define_singleton_method(ali) do |*args, &block|
        send(accessor).send(method, *args, &block)
      end
    end
  end

  def def_single_delegators(accessor, *methods)
    methods.each do |method|
      next if method == :__send__ || method == :__id__
      def_single_delegator(accessor, method)
    end
  end

  def single_delegate(hash)
    hash.each do |methods, accessor|
      methods = [methods] unless methods.is_a?(Array)
      methods.each do |method|
        def_single_delegator(accessor, method)
      end
    end
  end

  alias delegate single_delegate
  alias def_delegators def_single_delegators
  alias def_delegator def_single_delegator
end
