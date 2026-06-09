# Classic FizzBuzz on the V8 engine.
(1..30).each do |n|
  puts case
       when n % 15 == 0 then "FizzBuzz"
       when n % 3 == 0  then "Fizz"
       when n % 5 == 0  then "Buzz"
       else n
       end
end
