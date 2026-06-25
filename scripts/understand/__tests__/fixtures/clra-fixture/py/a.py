"""a.py — entry-point module (mirrors src/a.ts).

main() is the Python ENTRY POINT. It calls add + multiply (cross-file, from b)
and sum_list_one + sum_list_two (intra-file), and constructs a Circle.
sum_list_one / sum_list_two are a NEAR-DUPLICATE clone pair.
"""

from b import add, multiply
from shapes import Circle


# ENTRY POINT.
def main():
    s = add(2, 3)
    p = multiply(4, 5)
    total = sum_list_one([1, 2, 3])
    total2 = sum_list_two([4, 5, 6])
    c = Circle(2)
    print(s, p, total, total2, c.area())


# CLONE A — near-duplicate of sum_list_two (different local names only).
def sum_list_one(xs):
    total = 0
    for i in range(len(xs)):
        total = total + xs[i]
    return total


# CLONE B — near-duplicate of sum_list_one.
def sum_list_two(xs):
    acc = 0
    for i in range(len(xs)):
        acc = acc + xs[i]
    return acc


if __name__ == "__main__":
    main()
