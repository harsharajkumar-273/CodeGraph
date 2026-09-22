from pkg import Engine
import pkg.utils as u


def make() -> Engine:
    return Engine()


def main():
    e = Engine()
    e.start()
    u.helper()


if __name__ == "__main__":
    main()
