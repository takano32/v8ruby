class Stack
  def initialize
    @items = []
  end
  def push(x)
    @items.push(x)
    self
  end
  def pop
    @items.pop
  end
  def peek
    @items.last
  end
  def empty?
    @items.empty?
  end
  def size
    @items.size
  end
  def to_s
    "Stack(#{@items.join(', ')})"
  end
end

s = Stack.new
s.push(1).push(2).push(3)
puts s
puts s.size
puts s.pop
puts s.peek
puts s.empty?

class LinkedList
  include Enumerable
  Node = Struct.new(:value, :next) rescue nil
  def initialize
    @head = nil
  end
  def add(v)
    @head = [v, @head]
    self
  end
  def each
    cur = @head
    while cur
      yield cur[0]
      cur = cur[1]
    end
  end
end

list = LinkedList.new
list.add(1).add(2).add(3)
puts list.map { |x| x * 10 }.inspect
puts list.to_a.inspect
puts list.select(&:even?).inspect
puts list.include?(2)
