// "v4 classic": only some methods are visible as class methods (`trim`, `safeParse`);
// `parse` and `optional` are attached dynamically in a way the extractor can't see.
export class ZodType {
  safeParse(data: unknown): unknown {
    return data;
  }
  trim(): ZodType {
    return this;
  }
}

export class ZodString extends ZodType {}

export function string(): ZodString {
  const inst: any = new ZodString();
  Object.assign(inst, { parse: (d: unknown) => d, optional: () => inst });
  return inst;
}

// Instance-initializer style: `inst` is the callback's own parameter, so this IS how `shout` is defined.
declare function init(fn: (inst: any) => void): void;
init((inst) => {
  inst.shout = function shout() {
    return 'x';
  };
});
