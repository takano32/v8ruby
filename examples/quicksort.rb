# Recursive quicksort.
def quicksort(arr)
  return arr if arr.size <= 1
  pivot, *rest = arr
  left, right = rest.partition { |x| x < pivot }
  quicksort(left) + [pivot] + quicksort(right)
end

p quicksort([5, 2, 9, 1, 7, 3, 8, 4, 6])
