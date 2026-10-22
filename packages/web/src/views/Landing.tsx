import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconArrowRight, IconGithub, IconLogo, IconUpload } from '../ui/icons';
import { entriesFromDrop, entriesFromFileList, type Picked } from '../sources/local';

export interface LandingError {
  message: string;
  hint?: string;
}

const EXAMPLES: { repo: string; lang: string; note?: string }[] = [
  { repo: 'pallets/flask', lang: 'Python' },
  { repo: 'psf/requests', lang: 'Python' },
  { repo: 'expressjs/express', lang: 'JavaScript' },
  { repo: 'immerjs/immer', lang: 'TypeScript' },
  { repo: 'honojs/hono', lang: 'TypeScript' },
  { repo: 'colinhacks/zod', lang: 'TypeScript', note: 'large' },
];

const REPO_URL = 'https://github.com/harsharajkumar-273/CodeGraph';

export function Landing({
  error,
  initialValue = '',
  onRepo,
  onPick,
  onGraphFile,
}: {
  error?: LandingError | null;
  initialValue?: string;
  onRepo: (input: string) => void;
  /** A folder, some files or a .zip from this machine. `resolve` reads them; the app shows progress while it runs. */
  onPick: (resolve: () => Promise<Picked>) => void;
  onGraphFile: (file: File) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const graphInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  // A dropped folder anywhere on the page is accepted, and the browser must not navigate to it.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth.current <= 0) {
        depth.current = 0;
        setDragging(false);
      }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      const picked = entriesFromDrop(dt); // must start inside the event: the dropped entries expire after it
      onPick(() => picked);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [onPick]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onRepo(value);
  };

  const shown = error ?? null;

  return (
    <div className="landing">
      <header className="landing-top">
        <div className="brand">
          <IconLogo width={22} height={22} className="brand-logo" />
          <span>CodeGraph</span>
        </div>
        <nav>
          <a href={`${REPO_URL}/blob/main/docs/ORACLE-EVAL.md`} target="_blank" rel="noreferrer">How accurate is it?</a>
          <a href="https://www.npmjs.com/package/codegraph-engine" target="_blank" rel="noreferrer">npm</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="with-icon">
            <IconGithub /> GitHub
          </a>
        </nav>
      </header>

      <main className="landing-main">
        <span className="eyebrow">Runs in your browser · nothing is uploaded</span>
        <h1>
          See what breaks <em>before</em> you change it
        </h1>
        <p className="lede">
          Paste a GitHub repository, or drop a folder, some files or a .zip from your computer. CodeGraph maps the imports and calls across TypeScript, JavaScript and Python, then shows exactly which functions, files and tests a change could reach.
        </p>

        <form className="repo-form" onSubmit={submit}>
          <IconGithub className="repo-form-icon" width={18} height={18} />
          <input
            aria-label="GitHub repository"
            placeholder="owner/repo or a github.com link"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button type="submit" className="primary" disabled={!value.trim()}>
            Analyze <IconArrowRight />
          </button>
        </form>

        {shown && (
          <div className="callout error" role="alert">
            <strong>{shown.message}</strong>
            {shown.hint && <span> {shown.hint}</span>}
          </div>
        )}

        <div className="examples">
          <span className="examples-label">Try</span>
          {EXAMPLES.map((x) => (
            <button key={x.repo} type="button" className="chip-btn" onClick={() => onRepo(x.repo)} title={`${x.lang}${x.note ? `, ${x.note}` : ''}`}>
              {x.repo}
              <small>{x.note ?? x.lang}</small>
            </button>
          ))}
        </div>

        <div className="or">
          <span>or</span>
        </div>

        <div className="drop">
          <IconUpload width={26} height={26} />
          <span className="drop-text">
            <strong>Drop a folder, files or a .zip here</strong>
            <span>Read inside this tab and never uploaded. Dragging a folder in is faster than choosing it: node_modules and .git are skipped before anything is read.</span>
          </span>
          <span className="drop-actions">
            <button type="button" className="ghost sm" onClick={() => folderInput.current?.click()}>
              Choose a folder
            </button>
            <button type="button" className="ghost sm" onClick={() => filesInput.current?.click()}>
              Choose files or a .zip
            </button>
          </span>
        </div>
        <input
          ref={folderInput}
          type="file"
          hidden
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []); // copy: clearing the input below empties the live list
            e.target.value = '';
            if (files.length) onPick(() => entriesFromFileList(files));
          }}
        />
        <input
          ref={filesInput}
          type="file"
          multiple
          hidden
          accept=".ts,.tsx,.mts,.cts,.js,.jsx,.mjs,.cjs,.py,.zip"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onPick(() => entriesFromFileList(files));
          }}
        />
        <input
          ref={graphInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onGraphFile(f);
            e.target.value = '';
          }}
        />
      </main>

      <footer className="landing-foot">
        <p>
          Every call edge is labelled <b className="t-resolved">resolved</b>, <b className="t-probable">probable</b> or <b className="t-ambiguous">ambiguous</b>, so you can see how much of a blast radius is proven and how much is a guess. Checked against the TypeScript compiler and Jedi on six repositories, 98–99% of resolved edges were correct.
        </p>
        <p className="muted">
          Already have a graph? <button className="link" onClick={() => graphInput.current?.click()}>Open a graph.json</button> from <code>codegraph index</code>.
        </p>
      </footer>

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <IconUpload width={40} height={40} />
          <strong>Drop a folder, files or a .zip</strong>
          <span>It is read in this tab and never uploaded</span>
        </div>
      )}
    </div>
  );
}
