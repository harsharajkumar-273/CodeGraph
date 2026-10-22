// Reads a .zip (for example GitHub's "Download ZIP") in the page. Only the entries worth analyzing are decompressed:
// dependencies, build output and anything that isn't source or config are skipped from the archive's index, so a zip
// with a node_modules folder costs nothing extra.
import { unzip, type UnzipFileInfo } from 'fflate';
import { createFilter } from '@codegraph/extractors/browser';
import type { FolderFile } from './local';
import { LIMITS, LoadError } from './types';

const MAX_ZIP_BYTES = 250_000_000;
const KEEP_NAMES = new Set(['.gitignore', '.codegraphignore']);
/** Files that say "this folder is a project root". */
const PROJECT_MARKERS = new Set(['package.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'tsconfig.json', 'go.mod']);
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';

export async function entriesFromZip(file: File): Promise<{ name: string; files: FolderFile[]; detail: string; notes: string[] }> {
  if (file.size > MAX_ZIP_BYTES) {
    throw new LoadError('empty', `${file.name} is larger than ${Math.round(MAX_ZIP_BYTES / 1e6)} MB.`, 'Zip just the source folders, or choose the project folder itself.');
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const prune = createFilter();
  const tops = new Set<string>(); // first path segment of every entry, kept or not
  const markerTops = new Set<string>(); // top-level folders that hold a project file directly
  let anyFile = false;
  let bytes = 0;
  let overBudget = 0;
  const filter = (info: UnzipFileInfo) => {
    const name = info.name;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) return false;
    anyFile = true;
    tops.add(name.includes('/') ? name.slice(0, name.indexOf('/')) : '');
    if (name.split('/').length === 2 && PROJECT_MARKERS.has(base(name))) markerTops.add(name.slice(0, name.indexOf('/')));
    if (prune.ignoresFile(name) || info.originalSize > LIMITS.maxFileBytes) return false;
    const b = base(name);
    if (!(prune.isSource(b) || prune.isConfig(b) || KEEP_NAMES.has(b))) return false;
    if (bytes + info.originalSize > LIMITS.maxTotalBytes) {
      overBudget++;
      return false;
    }
    bytes += info.originalSize;
    return true;
  };
  const out = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(data, { filter }, (err, res) => (err ? reject(new LoadError('invalid-input', `Couldn't open ${file.name} as a zip file.`, 'Check that it is a valid .zip archive.')) : resolve(res))),
  );
  if (!anyFile) throw new LoadError('empty', `${file.name} is empty.`);
  // GitHub's "Download ZIP" (and "Compress" in a file manager) wrap everything in one folder, named like the zip or
  // holding the project's files; paths should start inside it. A zip that just happens to hold one folder (a `src/`
  // on its own) is left alone.
  const zipName = file.name.replace(/\.zip$/i, '');
  const only = tops.size === 1 && !tops.has('') ? [...tops][0] : undefined;
  const strip = only && (only.toLowerCase() === zipName.toLowerCase() || markerTops.has(only)) ? only + '/' : '';
  const files: FolderFile[] = Object.entries(out).map(([path, bytes]) => {
    const rel = strip && path.startsWith(strip) ? path.slice(strip.length) : path;
    return { path: rel, file: new File([new Uint8Array(bytes)], base(rel)) };
  });
  const notes = overBudget ? [`The zip holds more source than fits in a browser tab, so ${overBudget} file${overBudget === 1 ? ' was' : 's were'} left out.`] : [];
  return { name: zipName, files, detail: 'from a .zip', notes };
}
