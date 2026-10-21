export class Store {
  get(key: string): string {
    return key
  }

  has(key: string): boolean {
    return !!key
  }

  parse(text: string): string {
    return text
  }

  text(): string {
    return ''
  }
}
