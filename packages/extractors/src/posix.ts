// The four POSIX path functions the resolver needs, without `node:path` so the indexer also runs in a browser.
// Behaviour matches `path.posix` (checked against it in test/browser-parity.test.ts).

export function normalize(path: string): string {
  if (path === '') return '.';
  const absolute = path.startsWith('/');
  const trailing = path.endsWith('/');
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else out.push(seg);
  }
  let res = out.join('/');
  if (!res && !absolute) res = '.';
  if (res && trailing) res += '/';
  return (absolute ? '/' : '') + res;
}

export function join(...parts: string[]): string {
  const joined = parts.filter((x) => x !== '').join('/');
  return joined === '' ? '.' : normalize(joined);
}

export function dirname(path: string): string {
  if (path === '') return '.';
  const hasRoot = path.startsWith('/');
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; i--) {
    if (path[i] === '/') {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else matchedSlash = false;
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

export function basename(path: string): string {
  const end = path.replace(/\/+$/, '');
  return end.slice(end.lastIndexOf('/') + 1);
}
