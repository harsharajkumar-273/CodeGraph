export class Page {
  text(): string {
    return 'page'
  }
}

export class Client {
  async fetchPage(): Promise<Page> {
    return new Page()
  }

  request = (path: string): Response | Promise<Response> => new Response(path)
}

export function makeClient(): Client {
  return new Client()
}
