from client import make_client


def run():
    client = make_client()
    page = client.get("/")
    page.text()
    label = client.name()
    return label.upper()


def merge(jar, fresh):
    if fresh:
        jar = make_client()
    return jar.get("/")
