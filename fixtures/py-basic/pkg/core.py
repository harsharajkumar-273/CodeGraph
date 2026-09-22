from .utils import helper


class Base:
    def warm(self):
        return 0


class Engine(Base):
    def start(self):
        self.warm()
        self._spin()
        return helper()

    def _spin(self):
        return 2


def transform(raw):
    trimmed = raw.strip()
    total = len(trimmed)
    total += 1
    for ch in trimmed:
        total += len(ch)
    return total
