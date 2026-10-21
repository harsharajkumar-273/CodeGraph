import { Context } from './context'

export function handler(c: Context) {
  return c.text('hi')
}
