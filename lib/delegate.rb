# delegate shim for v8ruby — pure-Ruby subset of MRI's delegate.
#
# Differences from MRI:
# - Delegator is a plain Object subclass. MRI's inherits BasicObject and
#   undefs most Kernel methods so to_s/inspect/===/=~/<=>/hash/eql? fall
#   through to method_missing; here they are forwarded explicitly, which
#   gives the same observable results.
# - `!delegator` is NOT forwarded: v8ruby's `!` operator never dispatches
#   to a `!` method (the #! definition below is only reachable via send).
#   Same for the `!~` operator.
# - v8ruby's dup/clone don't invoke initialize_dup/initialize_clone hooks,
#   so dup/clone are overridden directly to copy the target.
# - DelegateClass() is not provided.

class Delegator
  def initialize(obj)
    __setobj__(obj)
  end

  def __getobj__
    raise NotImplementedError, "need to define '__getobj__'"
  end

  def __setobj__(obj)
    raise NotImplementedError, "need to define '__setobj__'"
  end

  def method_missing(m, *args, &block)
    target = __getobj__
    if target.respond_to?(m)
      target.__send__(m, *args, &block)
    else
      super
    end
  end

  def respond_to_missing?(m, include_private = false)
    __getobj__.respond_to?(m, include_private)
  end

  def ==(obj)
    return true if obj.equal?(self)
    __getobj__ == obj
  end

  def !=(obj)
    return false if obj.equal?(self)
    __getobj__ != obj
  end

  def !
    !__getobj__
  end

  def eql?(obj)
    return true if obj.equal?(self)
    obj.eql?(__getobj__)
  end

  # MRI undefs these on its BasicObject-based class so they reach
  # method_missing; forward explicitly instead.
  def to_s
    __getobj__.to_s
  end

  def inspect
    __getobj__.inspect
  end

  def ===(other)
    __getobj__ === other
  end

  def =~(other)
    __getobj__ =~ other
  end

  def <=>(other)
    __getobj__ <=> other
  end

  def hash
    __getobj__.hash
  end

  def freeze
    __getobj__.freeze
    super
  end

  def dup
    copy = super
    copy.__setobj__(__getobj__.dup)
    copy
  end

  def clone
    copy = super
    copy.__setobj__(__getobj__.clone)
    copy
  end

  def methods
    __getobj__.methods | super
  end
end

class SimpleDelegator < Delegator
  def __getobj__
    @delegate_sd_obj
  end

  def __setobj__(obj)
    raise ArgumentError, "cannot delegate to self" if equal?(obj)
    @delegate_sd_obj = obj
  end
end
