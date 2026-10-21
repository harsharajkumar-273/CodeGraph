import { Store } from './store'

export function natives(raw: string, store: Store) {
  const seen = new Map<string, number>()
  seen.get(raw) // Map#get, not Store.get
  const tags: Set<string> = new Set()
  tags.has(raw) // Set#has
  const data = JSON.parse(raw) // JSON.parse, not Store.parse
  Promise.resolve(data)
  console.log(data)
  return store.get(raw) // typed receiver: still Store.get
}

export function shadowed(store: Store) {
  const process = store
  return process.parse('x') // a local named `process` is not the Node global
}

export function union(item: Store | Date | Promise<Store>) {
  return item.text() // a union is not "Promise": the name match to Store.text stays
}
