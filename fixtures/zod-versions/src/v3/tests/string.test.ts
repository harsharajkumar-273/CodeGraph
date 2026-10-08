import * as z from 'zodlike/v3';

export function v3Test() {
  const s = z.string();
  return s.parse('x'); // genuinely v3
}
