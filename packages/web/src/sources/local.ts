// Reads a folder from the visitor's own machine. Files are read in the page and never leave it.
import { createFilter } from '@codegraph/extractors/browser';
import { pool } from './github';
import { LIMITS, LoadError, type LoadProgress, type LoadedSource } from './types';
import { entriesFromZip, isZip } from './zip';

/** A file with its path relative to the chosen folder. */
export interface FolderFile {
  path: string;
  file: File;
}

/** Everything a person can hand over: a folder, some files, or a zip, as a list of files with paths. */
export interface Picked {
  name: string;
  files: FolderFile[];
  /** Second line for the header (`local folder`, `from a .zip`). */
  detail?: string;
  notes?: string[];
}

const NOTHING = () => new LoadError('invalid-input', 'There is nothing to analyze there.', 'Pick a project folder, some .ts, .js or .py files, or a .zip.');

/** Distinct paths for loose files (two picked files may share a name when they came from different folders). */
function flat(files: File[]): FolderFile[] {
  const seen = new Map<string, number>();
  return files.map((file) => {
    const n = (seen.get(file.name) ?? 0) + 1;
    seen.set(file.name, n);
    const dot = file.name.lastIndexOf('.');
    return { path: n === 1 ? file.name : dot > 0 ? `${file.name.slice(0, dot)}-${n}${file.name.slice(dot)}` : `${file.name}-${n}`, file };
  });
}

const looseLabel = (files: File[]) => (files.length === 1 ? files[0].name : `${files.length} files`);

/**
 * What an `<input type="file">` returned. From a folder picker (`webkitdirectory`) every file's `webkitRelativePath`
 * starts with the folder's own name; from a plain picker the files are loose. A single .zip is unpacked.
 */
export async function entriesFromFileList(list: FileList | File[]): Promise<Picked> {
  const all = Array.from(list);
  if (!all.length) throw NOTHING();
  const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || '';
  if (all.length === 1 && isZip(all[0]) && !rel(all[0])) return entriesFromZip(all[0]);
  if (!all.some(rel)) return { name: looseLabel(all), files: flat(all), detail: all.length === 1 ? 'one file' : 'local files' };
  const prune = createFilter();
  const files: FolderFile[] = [];
  let name = '';
  for (const file of all) {
    const r = rel(file);
    const slash = r.indexOf('/');
    if (slash < 0) continue;
    name ||= r.slice(0, slash);
    const path = r.slice(slash + 1);
    if (!prune.ignoresFile(path)) files.push({ path, file }); // node_modules and friends are dropped before anything is read
  }
  return { name: name || 'folder', files };
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, err: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (e: FsEntry[]) => void, err: (e: unknown) => void): void };
}

/**
 * From a drop: one folder, loose files, several folders and files together, or a .zip. The entries must be taken from
 * the event synchronously (they are invalid after the first await), so call this directly from the drop handler.
 * Folders are pruned while walking: `node_modules` or `.git` are never entered, which matters when a project has a
 * hundred thousand files in them.
 */
export async function entriesFromDrop(dt: DataTransfer): Promise<Picked> {
  const roots: FsEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  const loose = Array.from(dt.files); // for browsers that give no entries
  if (!roots.length) return entriesFromFileList(loose);

  const prune = createFilter();
  const fileOf = (e: FsEntry) => new Promise<File>((ok, err) => e.file!(ok, err));
  const readAll = async (dir: FsEntry) => {
    const reader = dir.createReader!();
    const out: FsEntry[] = [];
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (!batch.length) return out;
      out.push(...batch);
    }
  };
  const files: FolderFile[] = [];
  const walk = async (dir: FsEntry, path: string) => {
    for (const e of await readAll(dir)) {
      const p = path ? `${path}/${e.name}` : e.name;
      if (e.isDirectory) {
        if (!prune.ignoresDir(p)) await walk(e, p);
      } else if (e.isFile && !prune.ignoresFile(p)) files.push({ path: p, file: await fileOf(e) });
    }
  };

  if (roots.length === 1 && roots[0].isDirectory) {
    await walk(roots[0], '');
    return { name: roots[0].name, files };
  }
  if (roots.length === 1) return entriesFromFileList([await fileOf(roots[0])]); // one file, or one .zip
  // Several things at once: folders keep their own name as a path prefix, files sit at the top.
  const looseFiles: File[] = [];
  for (const r of roots) {
    if (r.isDirectory) await walk(r, r.name);
    else if (r.isFile) looseFiles.push(await fileOf(r));
  }
  files.push(...flat(looseFiles));
  const onlyFiles = looseFiles.length === roots.length;
  return { name: onlyFiles ? looseLabel(looseFiles) : `${roots.length} items`, files, detail: onlyFiles ? 'local files' : 'dropped items' };
}

/** Applies the same selection rules as the GitHub loader and reads the surviving files. */
export async function loadFolder(
  folder: Picked,
  opts: { signal?: AbortSignal; onProgress?: (p: LoadProgress) => void } = {},
): Promise<LoadedSource> {
  const byPath = new Map(folder.files.map((f) => [f.path, f.file]));
  const readText = async (path: string) => byPath.get(path)?.text();
  const filter = createFilter({ gitignore: await readText('.gitignore'), codegraphignore: await readText('.codegraphignore') });

  const sources: FolderFile[] = [];
  const configs: FolderFile[] = [];
  let tooLarge = 0;
  for (const f of folder.files) {
    if (filter.ignoresFile(f.path)) continue;
    const name = f.path.slice(f.path.lastIndexOf('/') + 1);
    if (filter.isConfig(name) && f.file.size <= LIMITS.maxFileBytes) configs.push(f);
    if (!filter.isSource(name)) continue;
    if (f.file.size > LIMITS.maxFileBytes) tooLarge++;
    else sources.push(f);
  }
  if (!sources.length) {
    throw new LoadError('empty', `No TypeScript, JavaScript or Python files found in ${folder.name}.`, 'CodeGraph reads .ts, .tsx, .js, .jsx, .mjs, .cjs and .py files, from a folder, loose files or a .zip.');
  }
  sources.sort((a, b) => (a.path < b.path ? -1 : 1));

  const files = new Map<string, string>();
  const configMap = new Map<string, string>();
  const jobs = [...sources.map((f) => ({ f, config: false })), ...configs.map((f) => ({ f, config: true }))];
  let done = 0;
  let failed = 0;
  opts.onProgress?.({ phase: 'read', done, total: jobs.length, message: 'Reading files…' });
  await pool(
    jobs,
    LIMITS.concurrency,
    async ({ f, config }) => {
      try {
        (config ? configMap : files).set(f.path, await f.file.text());
      } catch {
        failed++;
      }
      opts.onProgress?.({ phase: 'read', done: ++done, total: jobs.length, message: 'Reading files…' });
    },
    opts.signal,
  );
  if (opts.signal?.aborted) throw new LoadError('cancelled', 'Cancelled.');

  const notes: string[] = [...(folder.notes ?? [])];
  if (tooLarge) notes.push(`${tooLarge} file${tooLarge === 1 ? ' was' : 's were'} skipped for being over 1 MB.`);
  if (failed) notes.push(`${failed} file${failed === 1 ? '' : 's'} could not be read and ${failed === 1 ? 'was' : 'were'} skipped.`);
  return { label: folder.name, detail: folder.detail ?? 'local folder', origin: { kind: 'folder' }, files, configs: configMap, notes };
}
