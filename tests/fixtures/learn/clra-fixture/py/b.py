"""b.py — utility module imported by a.py (mirrors src/b.ts).

Ground truth: `add` and `multiply` are call targets of a.py:main (cross-file).
`unused_helper` is a DEAD function: zero callers, not an entry point.
"""


def add(a, b):
    return a + b


def multiply(a, b):
    result = 0
    for _ in range(b):
        result = result + a
    return result


# DEAD: nothing in the fixture calls unused_helper, and it is not an entry point.
def unused_helper(x):
    return x * 2
