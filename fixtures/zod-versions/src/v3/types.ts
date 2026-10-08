// "v3": the legacy implementation. Same API names as v4, different code.
export class ZodType {
  parse(data: unknown): unknown {
    return data;
  }
  safeParse(data: unknown): unknown {
    return this.parse(data);
  }
  optional(): ZodType {
    return this;
  }
  trim(): ZodType {
    return this;
  }
}

export class ZodString extends ZodType {}

export function string(): ZodString {
  return new ZodString();
}
