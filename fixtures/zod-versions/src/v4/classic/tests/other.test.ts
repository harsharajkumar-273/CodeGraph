import * as z from 'zodlike/v4';

export function usesSchema() {
  const schema = z.string();
  return schema.parse('x'); // must not be wired to footprint.test.ts's local override
}
