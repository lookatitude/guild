# G1 fixture (Python) — known structural facts:
#   inherits edge: Dog -> Animal
#   calls edge   : Dog.speak -> bark

class Animal:
    def speak(self):
        return "..."


class Dog(Animal):
    def speak(self):
        return bark()


def bark():
    return "woof"


def main():
    d = Dog()
    return d.speak()
