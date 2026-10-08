import * as z from 'zodlike/v4';

export function parseIt() {
  const s = z.string();
  s.parse('x'); // dynamic in v4: must NOT resolve to v3's ZodType.parse
  s.optional(); // dynamic in v4: must NOT resolve to v3's ZodType.optional
  return s.safeParse('y'); // v4 classic ZodType.safeParse (not v3's)
}

export function trimIt() {
  return z.string().trim(); // v4 classic ZodType.trim (not v3's)
}

export function shoutIt() {
  return z.string().shout(); // defined in an instance initializer in v4 classic: keep this edge
}
