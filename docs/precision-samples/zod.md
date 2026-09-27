# Precision sample — colinhacks__zod


## resolved (11 of 4354 total)

### [resolved] #1: packages/zod/src/v4/core/util.ts#pick -> packages/zod/src/v4/core/util.ts#maskedKeys

**Call site** (packages/zod/src/v4/core/util.ts#pick:764):
```
   762: 
   763:   const newShape: Writeable<schemas.$ZodShape> = {};
>> 764:   mirrorShape(newShape, schema, maskedKeys(schema, mask));
   765: 
   766:   return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] })) as any;
```

**Target definition** (packages/zod/src/v4/core/util.ts#maskedKeys):
```
   770: function maskedKeys(schema: schemas.$ZodObject, mask: object): PropertyKey[] {
   771:   const raw = sourceShape(schema);
   772:   const keys: PropertyKey[] = [];
   773:   // `for...in` skips symbols, so a symbol in the mask would select nothing
   774:   for (const key of Reflect.ownKeys(mask)) {
   775:     if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
   776:       throw new Error(`Unrecognized key: "${String(key)}"`);
   777:     }
   778:     if ((mask as any)[key]) keys.push(key);
   779:   }
   780:   return keys;
```

**Verdict:** correct

---

### [resolved] #2: packages/bench/compile-passthrough.ts -> packages/bench/compile-passthrough.ts#smallBuildNew

**Call site** (packages/bench/compile-passthrough.ts:44):
```
   42: console.log("=== Small Object (3 props) ===");
   43: console.log("Return input:", smallReturnInput(DATA_SMALL[0]));
>> 44: console.log("Build new:", smallBuildNew(DATA_SMALL[0]));
   45: console.log("Spread:", smallSpread(DATA_SMALL[0]));
   46: console.log("");
```

**Target definition** (packages/bench/compile-passthrough.ts#smallBuildNew):
```
   22: function smallBuildNew(input: Record<string, unknown>) {
   23:   if (typeof input !== "object") return undefined;
   24:   if (typeof input.name !== "string") return undefined;
   25:   if (typeof input.age !== "number") return undefined;
   26:   if (typeof input.active !== "boolean") return undefined;
   27:   return {
   28:     name: input.name,
   29:     age: input.age,
   30:     active: input.active,
   31:   };
   32: }
```

**Verdict:** correct

---

### [resolved] #3: scripts/triage-signal.ts#findClusters -> scripts/triage-signal.ts#jaccard

**Call site** (scripts/triage-signal.ts#findClusters:408):
```
   406:   for (let i = 0; i < items.length; i++) {
   407:     for (let j = i + 1; j < items.length; j++) {
>> 408:       if (jaccard(toks[i], toks[j]) >= threshold) parent[find(i)] = find(j);
   409:     }
   410:   }
```

**Target definition** (scripts/triage-signal.ts#jaccard):
```
   385: function jaccard(a: Set<string>, b: Set<string>): number {
   386:   if (!a.size || !b.size) return 0;
   387:   let shared = 0;
   388:   for (const t of a) if (b.has(t)) shared++;
   389:   return shared / (a.size + b.size - shared);
   390: }
```

**Verdict:** correct

---

### [resolved] #4: packages/bench/compile-base64-inline-vs-hoist.ts -> packages/bench/metabench.ts#metabench

**Call site** (packages/bench/compile-base64-inline-vs-hoist.ts:74):
```
   72: console.log("");
   73: 
>> 74: await metabench("single z.base64() validator — valid input", {
   75:   "runtime helper direct"() {
   76:     return isValidBase64(VALID);
```

**Target definition** (packages/bench/metabench.ts#metabench):
```
   14: export function metabench<D>(name: string, benchmarks?: Benchmarks<D>): Metabench {
   15:   let bench: Metabench;
   16:   if (BENCH === "tinybench") {
   17:     bench = new Tinybench(name, benchmarks || {});
   18:   } else if (BENCH === "benchmarkjs") {
   19:     bench = new BenchmarkJS(name, benchmarks || {});
   20:   } else if (BENCH === "mitata") {
   21:     bench = new Mitata(name, benchmarks || {});
   22:   } else {
   23:     throw new Error(`Unknown benchmark runner: ${BENCH}`);
   24:   }
```

**Verdict:** correct

---

### [resolved] #5: packages/zod/src/v3/tests/instanceof.test.ts -> packages/zod/src/v3/helpers/util.ts#assertEqual

**Call site** (packages/zod/src/v3/tests/instanceof.test.ts:30):
```
   28:   await expect(() => TestSchema.parse(12)).toThrow(/Input not instance of Test/);
   29: 
>> 30:   util.assertEqual<Test, z.infer<typeof TestSchema>>(true);
   31: });
   32: 
```

**Target definition** (packages/zod/src/v3/helpers/util.ts#assertEqual):
```
   5:   export const assertEqual = <A, B>(_: AssertEqual<A, B>): void => {};
```

**Verdict:** correct

---

### [resolved] #6: packages/zod/src/v4/mini/tests/index.test.ts -> packages/zod/src/v4/mini/schemas.ts#custom

**Call site** (packages/zod/src/v4/mini/tests/index.test.ts:797):
```
   795: // this returns both a schema and a check
   796: test("z.custom", () => {
>> 797:   const a = z.custom((val) => {
   798:     return typeof val === "string";
   799:   });
```

**Target definition** (packages/zod/src/v4/mini/schemas.ts#custom):
```
   1891: export function custom<O = unknown, I = O>(
   1892:   fn?: (data: O) => unknown,
   1893:   _params?: string | core.$ZodCustomParams | undefined
   1894: ): ZodMiniCustom<O, I> {
   1895:   return core._custom(ZodMiniCustom, fn ?? (() => true), _params) as any;
   1896: }
```

**Verdict:** correct

---

### [resolved] #7: packages/zod/src/v4/classic/tests/recursive-types.test.ts -> packages/zod/src/v4/classic/schemas.ts#array

**Call site** (packages/zod/src/v4/classic/tests/recursive-types.test.ts:73):
```
   71:     name: z.string(),
   72:     get subcategories() {
>> 73:       return z.array(Category).optional().nullable();
   74:     },
   75:   });
```

**Target definition** (packages/zod/src/v4/classic/schemas.ts#array):
```
   1556: export function array<T extends core.SomeType>(element: T, params?: string | core.$ZodArrayParams): ZodArray<T> {
   1557:   return core._array(ZodArray, element as any, params) as any;
   1558: }
```

**Verdict:** correct

---

### [resolved] #8: packages/zod/src/v3/types.ts#ZodDate.max -> packages/zod/src/v3/helpers/errorUtil.ts#toString

**Call site** (packages/zod/src/v3/types.ts#ZodDate.max:1962):
```
   1960:       kind: "max",
   1961:       value: maxDate.getTime(),
>> 1962:       message: errorUtil.toString(message),
   1963:     });
   1964:   }
```

**Target definition** (packages/zod/src/v3/helpers/errorUtil.ts#toString):
```
   6:   export const toString = (message?: ErrMessage): string | undefined =>
   7:     typeof message === "string" ? message : message?.message;
```

**Verdict:** correct

---

### [resolved] #9: packages/bench/memory/survey.ts -> packages/zod/src/v4/classic/schemas.ts#array

**Call site** (packages/bench/memory/survey.ts:43):
```
   41:   ["literal", () => z.literal("a")],
   42:   ["enum", () => z.enum(["a", "b"])],
>> 43:   ["array", () => z.array(z.string())],
   44:   ["object", () => z.object({ a: z.string() })],
   45:   ["record", () => z.record(z.string(), z.string())],
```

**Target definition** (packages/zod/src/v4/classic/schemas.ts#array):
```
   1556: export function array<T extends core.SomeType>(element: T, params?: string | core.$ZodArrayParams): ZodArray<T> {
   1557:   return core._array(ZodArray, element as any, params) as any;
   1558: }
```

**Verdict:** correct

---

### [resolved] #10: packages/zod/src/v4/classic/schemas.ts#inst.nonempty -> packages/zod/src/v4/core/api.ts#_minSize

**Call site** (packages/zod/src/v4/classic/schemas.ts#inst.nonempty:2039):
```
   2037:   inst.valueType = def.valueType;
   2038:   inst.min = (...args) => inst.check(core._minSize(...args));
>> 2039:   inst.nonempty = (params) => inst.check(core._minSize(1, params));
   2040:   inst.max = (...args) => inst.check(core._maxSize(...args));
   2041:   inst.size = (...args) => inst.check(core._size(...args));
```

**Target definition** (packages/zod/src/v4/core/api.ts#_minSize):
```
   995: export function _minSize(
   996:   minimum: number,
   997:   params?: string | $ZodCheckMinSizeParams
   998: ): checks.$ZodCheckMinSize<util.HasSize> {
   999:   return new checks.$ZodCheckMinSize({
   1000:     check: "min_size",
   1001:     ...util.normalizeParams(params),
   1002:     minimum,
   1003:   });
   1004: }
```

**Verdict:** correct

---

### [resolved] #11: packages/zod/src/v4/locales/no.ts#error -> packages/zod/src/v4/core/util.ts#parsedType

**Call site** (packages/zod/src/v4/locales/no.ts#error:67):
```
   65:       case "invalid_type": {
   66:         const expected = TypeDictionary[issue.expected] ?? issue.expected;
>> 67:         const receivedType = util.parsedType(issue.input);
   68:         const received = TypeDictionary[receivedType] ?? receivedType;
   69:         if (/^[A-Z]/.test(issue.expected)) {
```

**Target definition** (packages/zod/src/v4/core/util.ts#parsedType):
```
   1011: export function parsedType(data: unknown): errors.$ZodInvalidTypeExpected {
   1012:   const t = typeof data;
   1013:   switch (t) {
   1014:     case "number": {
   1015:       return Number.isNaN(data) ? "nan" : "number";
   1016:     }
   1017:     case "object": {
   1018:       if (data === null) {
   1019:         return "null";
   1020:       }
   1021:       if (Array.isArray(data)) {
```

**Verdict:** correct

---


## probable (11 of 581 total)

### [probable] #12: packages/zod/src/v3/tests/unions.test.ts -> packages/zod/src/v3/types.ts#ZodType.parse

**Call site** (packages/zod/src/v3/tests/unions.test.ts:24):
```
   22:     z.string(),
   23:   ]);
>> 24:   expect(schema.parse("asdf")).toEqual("asdf");
   25:   expect(schema.parse({ email: "asdlkjf@lkajsdf.com" })).toEqual({
   26:     email: "asdlkjf@lkajsdf.com",
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.parse):
```
   223:   parse(data: unknown, params?: util.InexactPartial<ParseParams>): Output {
   224:     const result = this.safeParse(data, params);
   225:     if (result.success) return result.data;
   226:     throw result.error;
   227:   }
```

**Verdict:** correct

---

### [probable] #13: packages/zod/src/v3/tests/string.test.ts -> packages/zod/src/v3/types.ts#ZodString.ip

**Call site** (packages/zod/src/v3/tests/string.test.ts:531):
```
   529:   expect(z.string().nanoid().isULID).toEqual(false);
   530: 
>> 531:   expect(z.string().ip().isEmail).toEqual(false);
   532:   expect(z.string().ip().isURL).toEqual(false);
   533:   expect(z.string().ip().isCUID).toEqual(false);
```

**Target definition** (packages/zod/src/v3/types.ts#ZodString.ip):
```
   1100:   ip(options?: string | { version?: IpVersion; message?: string | undefined }) {
   1101:     return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
   1102:   }
```

**Verdict:** correct

---

### [probable] #14: packages/zod/src/v4/core/compile.ts#generateStringFormatCheck -> packages/zod/src/v4/core/schemas.ts#isValidCreditCard

**Call site** (packages/zod/src/v4/core/compile.ts#generateStringFormatCheck:819):
```
   817:   }
   818:   if (fmt === "credit_card") {
>> 819:     const validator = addConstant(ctx, isValidCreditCard);
   820:     doc.write(`if (!${validator}(${accessor})) return INVALID;`);
   821:     return accessor;
```

**Target definition** (packages/zod/src/v4/core/schemas.ts#isValidCreditCard):
```
   1136: export function isValidCreditCard(input: string): boolean {
   1137:   if (!regexes.creditCard.test(input)) return false;
   1138:   return isLuhnAlgo(input.replace(CC_SANITIZE, ""));
   1139: }
```

**Verdict:** correct

---

### [probable] #15: packages/zod/src/v3/tests/pickomit.test.ts -> packages/zod/src/v3/types.ts#ZodObject.omit

**Call site** (packages/zod/src/v3/tests/pickomit.test.ts:49):
```
   47: 
   48: test("omit type inference", () => {
>> 49:   const nonameFish = fish.omit({ name: true });
   50:   type nonameFish = z.infer<typeof nonameFish>;
   51:   util.assertEqual<nonameFish, { age: number; nested: {} }>(true);
```

**Target definition** (packages/zod/src/v3/types.ts#ZodObject.omit):
```
   2789:   omit<Mask extends util.Exactly<{ [k in keyof T]?: true }, Mask>>(
   2790:     mask: Mask
   2791:   ): ZodObject<Omit<T, keyof Mask>, UnknownKeys, Catchall> {
   2792:     const shape: any = {};
   2793: 
   2794:     for (const key of util.objectKeys(this.shape)) {
   2795:       if (!mask[key]) {
   2796:         shape[key] = this.shape[key];
   2797:       }
   2798:     }
   2799: 
```

**Verdict:** correct

---

### [probable] #16: packages/zod/src/v3/tests/error.test.ts -> packages/zod/src/v3/types.ts#ZodType.parse

**Call site** (packages/zod/src/v3/tests/error.test.ts:43):
```
   41: test("type error with custom error map", () => {
   42:   try {
>> 43:     z.string().parse(234, { errorMap });
   44:   } catch (err) {
   45:     const zerr: z.ZodError = err as any;
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.parse):
```
   223:   parse(data: unknown, params?: util.InexactPartial<ParseParams>): Output {
   224:     const result = this.safeParse(data, params);
   225:     if (result.success) return result.data;
   226:     throw result.error;
   227:   }
```

**Verdict:** correct

---

### [probable] #17: packages/bench/memory/dict-mode.ts -> packages/zod/src/v4/classic/schemas.ts#inst.min

**Call site** (packages/bench/memory/dict-mode.ts:22):
```
   20:   ["z.object({a})", () => z.object({ a: z.string() })],
   21:   ["z.array(str)", () => z.array(z.string())],
>> 22:   ["z.string().min(1)", () => z.string().min(1)],
   23:   ["z.string().optional()", () => z.string().optional()],
   24:   ["z.email()", () => z.email()],
```

**Target definition** (packages/zod/src/v4/classic/schemas.ts#inst.min):
```
   1492:     inst.min = (value, params) => inst.check(checks.gte(value, params));
```

**Verdict:** correct — confirmed the right one among 4 same-named inst.min definitions in schemas.ts

---

### [probable] #18: packages/zod/src/v3/types.ts#ZodEffects._parse -> packages/zod/src/v3/types.ts#ZodType.transform

**Call site** (packages/zod/src/v3/types.ts#ZodEffects._parse:4344):
```
   4342: 
   4343:     if (effect.type === "preprocess") {
>> 4344:       const processed = effect.transform(ctx.data, checkCtx);
   4345: 
   4346:       if (ctx.common.async) {
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.transform):
```
   468:   transform<NewOut>(
   469:     transform: (arg: Output, ctx: RefinementCtx) => NewOut | Promise<NewOut>
   470:   ): ZodEffects<this, NewOut> {
   471:     return new ZodEffects({
   472:       ...processCreateParams(this._def),
   473:       schema: this,
   474:       typeName: ZodFirstPartyTypeKind.ZodEffects,
   475:       effect: { type: "transform", transform },
   476:     }) as any;
   477:   }
```

**Verdict:** wrong — effect.transform (a data property holding a plain callback) matched ZodType.transform (the builder method); a same-file name collision, not a version issue

---

### [probable] #19: packages/zod/src/v3/tests/intersection.test.ts -> packages/zod/src/v3/types.ts#ZodType.parseAsync

**Call site** (packages/zod/src/v3/tests/intersection.test.ts:86):
```
   84:   const cat = Registry.parse({ posts });
   85:   expect(cat.posts).toEqual(posts);
>> 86:   const asyncCat = await Registry.parseAsync({ posts });
   87:   expect(asyncCat.posts).toEqual(posts);
   88: });
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.parseAsync):
```
   292:   async parseAsync(data: unknown, params?: util.InexactPartial<ParseParams>): Promise<Output> {
   293:     const result = await this.safeParseAsync(data, params);
   294:     if (result.success) return result.data;
   295:     throw result.error;
   296:   }
```

**Verdict:** correct

---

### [probable] #20: packages/zod/src/v3/tests/transformer.test.ts -> packages/zod/src/v3/types.ts#ZodType.safeParseAsync

**Call site** (packages/zod/src/v3/tests/transformer.test.ts:47):
```
   45:   const strs = ["foo", "bar"];
   46: 
>> 47:   const result = await z
   48:     .string()
   49:     .transform(async (data, ctx) => {
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.safeParseAsync):
```
   298:   async safeParseAsync(
   299:     data: unknown,
   300:     params?: util.InexactPartial<ParseParams>
   301:   ): Promise<SafeParseReturnType<Input, Output>> {
   302:     const ctx: ParseContext = {
   303:       common: {
   304:         issues: [],
   305:         contextualErrorMap: params?.errorMap,
   306:         async: true,
   307:       },
   308:       path: params?.path || [],
```

**Verdict:** correct — confirmed via wider context: the chain's final call really is v3 ZodType.safeParseAsync

---

### [probable] #21: packages/zod/src/v3/tests/discriminated-unions.test.ts -> packages/zod/src/v3/types.ts#ZodType.transform

**Call site** (packages/zod/src/v3/tests/discriminated-unions.test.ts:154):
```
   152:         z.object({
   153:           type: z.literal("a"),
>> 154:           a: z
   155:             .string()
   156:             .refine(async () => true)
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.transform):
```
   468:   transform<NewOut>(
   469:     transform: (arg: Output, ctx: RefinementCtx) => NewOut | Promise<NewOut>
   470:   ): ZodEffects<this, NewOut> {
   471:     return new ZodEffects({
   472:       ...processCreateParams(this._def),
   473:       schema: this,
   474:       typeName: ZodFirstPartyTypeKind.ZodEffects,
   475:       effect: { type: "transform", transform },
   476:     }) as any;
   477:   }
```

**Verdict:** correct — confirmed via wider context: v3 chain's .transform()

---

### [probable] #22: packages/zod/src/v3/tests/record.test.ts -> packages/zod/src/v3/types.ts#ZodType.safeParse

**Call site** (packages/zod/src/v3/tests/record.test.ts:149):
```
   147:   expect(obj1.a).toBeUndefined();
   148: 
>> 149:   const obj2 = rec.safeParse(data);
   150:   expect(obj2.success).toBe(true);
   151:   if (obj2.success) {
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.safeParse):
```
   229:   safeParse(data: unknown, params?: util.InexactPartial<ParseParams>): SafeParseReturnType<Input, Output> {
   230:     const ctx: ParseContext = {
   231:       common: {
   232:         issues: [],
   233:         async: params?.async ?? false,
   234:         contextualErrorMap: params?.errorMap,
   235:       },
   236:       path: params?.path || [],
   237:       schemaErrorMap: this._def.errorMap,
   238:       parent: null,
   239:       data,
```

**Verdict:** correct

---


## ambiguous (11 of 1722 total)

### [ambiguous] #23: packages/zod/src/v4/core/schemas.ts#parseURLObject -> packages/zod/src/v3/types.ts#ZodType.parse

**Call site** (packages/zod/src/v4/core/schemas.ts#parseURLObject:561):
```
   559:     if (typeof URL !== "undefined") {
   560:       const URLStatic = URL as typeof URL & { parse?: (input: string) => URL | null };
>> 561:       if (typeof URLStatic.parse === "function") return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
   562:     }
   563:     // @ts-ignore
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.parse):
```
   223:   parse(data: unknown, params?: util.InexactPartial<ParseParams>): Output {
   224:     const result = this.safeParse(data, params);
   225:     if (result.success) return result.data;
   226:     throw result.error;
   227:   }
```

**Verdict:** wrong — URLStatic.parse (native URL.parse) matched ZodType.parse

---

### [ambiguous] #24: packages/bench/property-access.ts -> packages/bench/metabench.ts#Tinybench.run

**Call site** (packages/bench/property-access.ts:84):
```
   82: });
   83: 
>> 84: await bench.run();
   85: 
```

**Target definition** (packages/bench/metabench.ts#Tinybench.run):
```
   82:   async run() {
   83:     const bench = new Bench({ time: 1500 });
   84:     for (const [name, fn] of Object.entries(this.benchmarks)) {
   85:       bench.add(name, fn as any);
   86:     }
   87:     // await runBench(this.name, bench);
   88:     console.log();
   89:     console.log(`   benchmarking ${chalk.bold.white(this.name)} with ${chalk.bold.white(this.runner)}`);
   90: 
   91:     bench.addEventListener("cycle", (e) => {
   92:       const task = e.task?.result;
```

**Verdict:** correct — default BENCH=tinybench, matches Tinybench.run

---

### [ambiguous] #25: packages/zod/src/v4/mini/tests/error.test.ts -> packages/zod/src/v3/types.ts#ZodType.safeParse

**Call site** (packages/zod/src/v4/mini/tests/error.test.ts:12):
```
   10: 
   11: test("error inheritance", () => {
>> 12:   const e1 = z.string().safeParse(123).error!;
   13:   expect(e1).toBeInstanceOf(z.core.$ZodError);
   14:   expect(e1).toBeInstanceOf(Error);
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.safeParse):
```
   229:   safeParse(data: unknown, params?: util.InexactPartial<ParseParams>): SafeParseReturnType<Input, Output> {
   230:     const ctx: ParseContext = {
   231:       common: {
   232:         issues: [],
   233:         async: params?.async ?? false,
   234:         contextualErrorMap: params?.errorMap,
   235:       },
   236:       path: params?.path || [],
   237:       schemaErrorMap: this._def.errorMap,
   238:       parent: null,
   239:       data,
```

**Verdict:** wrong — file imports "zod/mini" but resolved to v3's ZodType.safeParse

---

### [ambiguous] #26: packages/zod/src/v4/classic/tests/to-json-schema.test.ts -> packages/zod/src/v3/types.ts#ZodType.safeParse

**Call site** (packages/zod/src/v4/classic/tests/to-json-schema.test.ts:499):
```
   497:     // lengths 1 (mod 4) carry no whole byte; the emitted pattern must reject them like parse does
   498:     for (const s of ["", "A", "AA", "AAA", "AAAA", "AAAAA"]) {
>> 499:       expect(pattern.test(s)).toBe(schema.safeParse(s).success);
   500:     }
   501:   });
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.safeParse):
```
   229:   safeParse(data: unknown, params?: util.InexactPartial<ParseParams>): SafeParseReturnType<Input, Output> {
   230:     const ctx: ParseContext = {
   231:       common: {
   232:         issues: [],
   233:         async: params?.async ?? false,
   234:         contextualErrorMap: params?.errorMap,
   235:       },
   236:       path: params?.path || [],
   237:       schemaErrorMap: this._def.errorMap,
   238:       parent: null,
   239:       data,
```

**Verdict:** wrong — file imports "zod" (=v4/classic) but resolved to v3's ZodType.safeParse

---

### [ambiguous] #27: packages/integration/fixtures/internal-types/cjs-test.cts -> packages/zod/src/v3/types.ts#ZodString.email

**Call site** (packages/integration/fixtures/internal-types/cjs-test.cts:9):
```
   7:   name: z.string(),
   8:   age: z.number().int().positive(),
>> 9:   email: z.string().email(),
   10:   tags: z.array(z.string()),
   11:   role: z.enum(["admin", "user", "guest"]),
```

**Target definition** (packages/zod/src/v3/types.ts#ZodString.email):
```
   1057:   email(message?: errorUtil.ErrMessage) {
   1058:     return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
   1059:   }
```

**Verdict:** wrong — file imports "zod" (=v4/classic) but resolved to v3's ZodString.email

---

### [ambiguous] #28: packages/zod/src/v4/classic/from-json-schema.ts#convertSchema -> packages/zod/src/v3/types.ts#ZodType.nullable

**Call site** (packages/zod/src/v4/classic/from-json-schema.ts#convertSchema:849):
```
   847:   // Handle nullable (OpenAPI 3.0)
   848:   if (schema.nullable === true && ctx.version === "openapi-3.0") {
>> 849:     baseSchema = z.nullable(baseSchema);
   850:   }
   851: 
```

**Target definition** (packages/zod/src/v3/types.ts#ZodType.nullable):
```
   447:   nullable(): ZodNullable<this> {
   448:     return ZodNullable.create(this, this._def) as any;
   449:   }
```

**Verdict:** wrong — z.nullable(x), a module-level function, matched ZodType.nullable(), an instance method (category + version mismatch)

---

### [ambiguous] #29: packages/zod/src/v4/classic/tests/error.test.ts -> packages/zod/src/v3/types.ts#ZodString.trim

**Call site** (packages/zod/src/v4/classic/tests/error.test.ts:889):
```
   887:   expect(err.stack!.startsWith("ZodError: [")).toBe(true);
   888:   expect(err.stack!).toContain("invalid_type");
>> 889:   expect(err.stack!.split("\n").some((line) => line.trim().startsWith("at "))).toBe(false);
   890: 
   891:   // the borrowed global is given back unchanged, including a caller's own value
```

**Target definition** (packages/zod/src/v3/types.ts#ZodString.trim):
```
   1231:   trim() {
   1232:     return new ZodString({
   1233:       ...this._def,
   1234:       checks: [...this._def.checks, { kind: "trim" }],
   1235:     });
   1236:   }
```

**Verdict:** wrong — native String.prototype.trim/startsWith on a plain string matched ZodString.trim

---

### [ambiguous] #30: packages/zod/src/v4/classic/tests/array.test.ts -> packages/zod/src/v3/types.ts#ZodString.length

**Call site** (packages/zod/src/v4/classic/tests/array.test.ts:43):
```
   41: 
   42: test("array length", () => {
>> 43:   const schema = z.array(z.string()).length(2);
   44:   schema.parse(["asdf", "asdf"]);
   45: 
```

**Target definition** (packages/zod/src/v3/types.ts#ZodString.length):
```
   1216:   length(len: number, message?: errorUtil.ErrMessage) {
   1217:     return this._addCheck({
   1218:       kind: "length",
   1219:       value: len,
   1220:       ...errorUtil.errToObj(message),
   1221:     });
   1222:   }
```

**Verdict:** wrong — ZodArray.length() matched v3 ZodString.length (wrong type and wrong version)

---

### [ambiguous] #31: packages/zod/src/v4/core/tests/locales/tg.test.ts -> packages/zod/src/v4/classic/tests/instance-footprint.test.ts#schema.parse

**Call site** (packages/zod/src/v4/core/tests/locales/tg.test.ts:81):
```
   79:   }
   80: 
>> 81:   expect(z.object({ name: z.string().min(1), age: z.number().min(0) }).parse({ name: "Ali", age: 30 })).toEqual({
   82:     name: "Ali",
   83:     age: 30,
```

**Target definition** (packages/zod/src/v4/classic/tests/instance-footprint.test.ts#schema.parse):
```
   53:   schema.parse = () => "overridden";
```

**Verdict:** wrong — schema.parse() matched an unrelated test file's local reassignment `schema.parse = () => "overridden"`

---

### [ambiguous] #32: packages/bench/datetime.ts -> packages/bench/metabench.ts#BenchmarkJS.run

**Call site** (packages/bench/datetime.ts:16):
```
   14: });
   15: 
>> 16: await bench.run();
   17: 
```

**Target definition** (packages/bench/metabench.ts#BenchmarkJS.run):
```
   150:   async run() {
   151:     const suite = new Benchmark.Suite();
   152:     console.log(`  benchmarking ${chalk.white(this.name)} with ${this.runner}`);
   153:     for (const name in this.benchmarks) {
   154:       const fn = this.benchmarks[name];
   155:       suite.add(name, fn);
   156:     }
   157:     suite.on("cycle", (event: Benchmark.Event) => {
   158:       // const target = event.target;
   159:       // console.log(target.name, target.hz, target.stats!.mean);
   160:       console.log(chalk.white.dim(`  → ${String(event.target)}`));
```

**Verdict:** wrong — default BENCH=tinybench, but resolved to BenchmarkJS.run instead of Tinybench.run

---

### [ambiguous] #33: packages/zod/src/v4/core/tests/locales/el.test.ts -> packages/zod/src/v3/types.ts#ZodString.startsWith

**Call site** (packages/zod/src/v4/core/tests/locales/el.test.ts:180):
```
   178: 
   179:   // Test invalid_format with startsWith
>> 180:   const startsWithSchema = z.string().startsWith("hello");
   181:   const startsWithResult = startsWithSchema.safeParse("world");
   182:   expect(startsWithResult.success).toBe(false);
```

**Target definition** (packages/zod/src/v3/types.ts#ZodString.startsWith):
```
   1184:   startsWith(value: string, message?: errorUtil.ErrMessage) {
   1185:     return this._addCheck({
   1186:       kind: "startsWith",
   1187:       value: value,
   1188:       ...errorUtil.errToObj(message),
   1189:     });
   1190:   }
```

**Verdict:** wrong — file imports "zod" (=v4/classic) but resolved to v3's ZodString.startsWith

---

