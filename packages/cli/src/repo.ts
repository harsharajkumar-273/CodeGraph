import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const GH = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** Accepts a local path, `owner/repo`, or a GitHub URL; clones (shallow) into a cache dir when needed. */
export async function resolveRepo(arg: string): Promise<string> {
  const local = resolve(arg);
  if (existsSync(local)) return local;
  const m = GH.exec(arg);
  if (!m) throw new Error(`Not a directory or GitHub repo: ${arg}`);
  const [, owner, name] = m;
  const dir = join(homedir(), '.cache', 'codegraph', 'repos', `${owner}__${name}`);
  if (existsSync(join(dir, '.git'))) {
    console.error(`Using cached clone: ${dir}`);
    return dir;
  }
  mkdirSync(join(homedir(), '.cache', 'codegraph', 'repos'), { recursive: true });
  console.error(`Cloning https://github.com/${owner}/${name} (shallow)...`);
  await exec('git', ['clone', '--depth', '1', `https://github.com/${owner}/${name}.git`, dir]);
  return dir;
}
