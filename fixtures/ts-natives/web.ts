// A repo class that shares a built-in type's name is still repo code.
export class Response {
  text(): string {
    return 'body'
  }
}

export function render() {
  const res = new Response()
  return res.text()
}
