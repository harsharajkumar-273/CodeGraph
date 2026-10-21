import { makeClient, Page } from './client'

export async function run() {
  const client = makeClient()
  const page = await client.fetchPage()
  page.text() // Page.text via fetchPage(): Promise<Page>
  const res = await client.request('/')
  return res.text() // Response#text: not Page.text
}

export function branch(page: Page, fresh: boolean) {
  if (fresh) page = new Page()
  return page.text()
}
