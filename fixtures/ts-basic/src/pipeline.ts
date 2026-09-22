export function pipeline(raw: string): number {
  const trimmed = raw.trim();
  let count = trimmed.length;
  count += 1;
  for (const ch of trimmed) {
    count += ch.length;
  }
  try {
    risky(count);
  } catch (err) {
    console.log(err);
  }
  return count;
}

function risky(n: number) {
  return n;
}
