# Pure-Ruby singleton shim for v8ruby.
# Matches MRI's Singleton for the common subset: lazy memoized .instance,
# private-ish .new/.allocate (raise NoMethodError), #clone/#dup raise TypeError.
module Singleton
  module SingletonClassMethods
    def instance
      # Per-class ivar: memoizes the single instance, created lazily.
      @singleton__instance__ ||= __singleton_original_new__
    end
  end

  def self.included(base)
    # Capture Class#new via alias BEFORE overriding; aliases are copies in
    # v8ruby, so the override below can't break instance creation.
    base.singleton_class.send(:alias_method, :__singleton_original_new__, :new)
    base.extend(SingletonClassMethods)
    base.define_singleton_method(:new) do |*args|
      raise NoMethodError, "private method 'new' called for class #{self}"
    end
    base.define_singleton_method(:allocate) do |*args|
      raise NoMethodError, "private method 'allocate' called for class #{self}"
    end
  end

  def clone
    raise TypeError, "can't clone instance of singleton #{self.class}"
  end

  def dup
    raise TypeError, "can't dup instance of singleton #{self.class}"
  end
end
