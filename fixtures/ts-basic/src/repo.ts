export class Repo {
  private items = new Map<string, string>();

  get(id: string): string | undefined {
    return this.items.get(id);
  }

  put(id: string, v: string) {
    this.items.set(id, v);
  }
}
