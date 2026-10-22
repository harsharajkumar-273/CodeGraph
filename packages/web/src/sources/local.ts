// Reads a folder from the visitor's own machine. Files are read in the page and never leave it.
import { createFilter } from '@codegraph/extractors/browser';
import { pool } from './github';
import { LIMITS, LoadError, type LoadProgress, type LoadedSource } from './types';

/** A file with its path relative to the chosen folder. */
export interface FolderFile {
  path: string;
  file: File;
}

/** From `<input type="file" webkitdirectory>`: every file's `webkitRelativePath` starts with the folder's own name. */
export function entriesFromFileList(list: FileList | File[]): { name: string; files: FolderFile[] } {
  const all = Array.from(list);
  const files: FolderFile[] = [];
  let name = '';
  for (const file of all) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const slash = rel.indexOf('/');
    if (slash < 0) continue;
    name ||= rel.slice(0, slash);
    files.push({ path: rel.slice(slash + 1), file });
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
 * From a drop. The entries must be taken from the event synchronously (they are invalid after the first await), and
 * directories are pruned while walking: `node_modules` or `.git` are never entered, which matters when a project has
 * a hundred thousand files in them.
 */
export async function entriesFromDrop(dt: DataTransfer): Promise<{ name: string; files: FolderFile[] } | null> {
  const roots: FsEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  const dirs = roots.filter((r) => r.isDirectory);
  if (dirs.length !== 1 || roots.length !== 1) return null; // exactly one folder
  const prune = createFilter();
  const files: FolderFile[] = [];
  const readAll = async (dir: FsEntry) => {
    const reader = dir.createReader!();
    const out: FsEntry[] = [];
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (!batch.length) return out;
      out.push(...batch);
    }
  };
  const walk = async (dir: FsEntry, path: string) => {
    for (const e of await readAll(dir)) {
      const p = path ? `${path}/${e.name}` : e.name;
      if (e.isDirectory) {
        if (!prune.ignoresDir(p)) await walk(e, p);
      } else if (e.isFile && !prune.ignoresFile(p)) {
        const file = await new Promise<File>((ok, err) => e.file!(ok, err));
        files.push({ path: p, file });
      }
    }
  };
  await walk(dirs[0], '');
  return { name: dirs[0].name, files };
}

/** Applies the same selection rules as the GitHub loader and reads the surviving files. */
export async function loadFolder(
  folder: { name: string; files: FolderFile[] },
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
    throw new LoadError('empty', `No TypeScript, JavaScript or Python files found in ${folder.name}.`, 'CodeGraph reads .ts, .tsx, .js, .jsx, .mjs, .cjs and .py files.');
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

  const notes: string[] = [];
  if (tooLarge) notes.push(`${tooLarge} file${tooLarge === 1 ? ' was' : 's were'} skipped for being over 1 MB.`);
  if (failed) notes.push(`${failed} file${failed === 1 ? '' : 's'} could not be read and ${failed === 1 ? 'was' : 'were'} skipped.`);
  return { label: folder.name, detail: 'local folder', origin: { kind: 'folder' }, files, configs: configMap, notes };
}
