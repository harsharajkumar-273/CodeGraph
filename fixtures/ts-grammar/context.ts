// Overloaded call signatures with no `;` between them: tree-sitter-typescript reads the line break as
// `Response<T extends …`, and here the error swallows the rest of the file, so Context and its methods vanished
// from the graph without any warning until parse() retried with separators (seen on Hono's context.ts).
interface Respond {
  <T extends Data>(
  ): Response
  <T extends null>(
  ): Response
}
type Data = string

export class Context {
  notFound = (): number => {
    return this.render(1)
  }

  text = (body: string): string => this.render(body)

  render(body: unknown): any {
    return body
  }
}
