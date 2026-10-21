class Page:
    def text(self):
        return "page"


class Client:
    def get(self, url) -> Page:
        return Page()

    def name(self) -> str:
        return "client"


def make_client() -> "Client":
    return Client()
