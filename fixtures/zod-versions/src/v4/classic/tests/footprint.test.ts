import * as z from 'zodlike/v4';

declare function test(name: string, fn: () => void): void;

test('overrides parse on one instance', () => {
  const schema: any = z.string();
  schema.parse = () => 'overridden'; // a one-off monkeypatch on a local, not a module-level method
  schema.parse('x'); // same file: this IS the override
});
