export class ZodMiniType {
  safeParse(data: unknown): unknown {
    return data;
  }
}

export function string(): ZodMiniType {
  return new ZodMiniType();
}
