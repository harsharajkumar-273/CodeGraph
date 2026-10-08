import * as z from 'zodlike/mini';

export function miniParse() {
  const s = z.string();
  return s.safeParse('y'); // ZodMiniType.safeParse: not classic's, not v3's
}
