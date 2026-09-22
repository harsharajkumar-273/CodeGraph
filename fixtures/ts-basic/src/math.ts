export function add(a: number, b: number): number {
  return a + b;
}

function mul(a: number, b: number): number {
  return a * b;
}

export function square(x: number): number {
  return mul(x, x);
}
