"""shapes.py — inheritance chain ground truth (mirrors src/shapes.ts).

    Circle(Shape)   → inherits edge

Python has no interfaces, so there is no `implements` mirror here; the
implements edge is TS-only (see src/shapes.ts).
"""


class Shape:
    def area(self):
        return 0


class Circle(Shape):
    def __init__(self, r):
        self.r = r

    def area(self):
        return 3.14 * self.r * self.r
