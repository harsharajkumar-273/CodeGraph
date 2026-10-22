import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconArrowRight, IconGithub, IconUpload } from '../ui/icons';
import { entriesFromDrop, entriesFromFileList, type Picked } from '../sources/local';
import { Accuracy, Cta, Features, Footer, HowItWorks, Nav, Preview, Terminal } from './landing/sections';
import './landing/landing.css';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const graphInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  // A dropped folder, files or zip anywhere on the page is accepted, and the browser must not navigate to them.
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
  const focusInput = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 350);
  };

  return (
    <div className="site" id="top">
      <Nav onAnalyze={focusInput} />
      <main>
        <section className="hero wrap">
          <span className="eyebrow">
            <i className="live-dot" aria-hidden /> Runs in your browser · nothing is uploaded
          </span>
          <h1>
            See what breaks <em>before</em> you change it
          </h1>
          <p className="lede">
            Paste a GitHub repository, or drop a folder, some files or a .zip from your computer. CodeGraph maps the imports and calls across TypeScript, JavaScript and Python, then shows exactly which functions, files and tests a change could reach.
          </p>

          <form className="repo-form" onSubmit={submit}>
            <IconGithub className="repo-form-icon" width={18} height={18} />
            <input
              ref={inputRef}
              aria-label="GitHub repository"
              placeholder="owner/repo or a github.com link"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button type="submit" className="primary" disabled={!value.trim()}>
              Analyze <IconArrowRight />
            </button>
          </form>

          {error && (
            <div className="callout error" role="alert">
              <strong>{error.message}</strong>
              {error.hint && <span> {error.hint}</span>}
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

          <div className="drop">
            <IconUpload width={22} height={22} />
            <span className="drop-text">
              <strong>Or drop a folder, files or a .zip here</strong>
              <span>Read inside this tab, never uploaded. Dragging a folder in is faster than choosing it: node_modules and .git are skipped before anything is read.</span>
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
          <p className="graph-link">
            Already have a graph? <button className="link" onClick={() => graphInput.current?.click()}>Open a graph.json</button> from <code>codegraph index</code>.
          </p>
        </section>

        <Preview />
        <HowItWorks />
        <Features />
        <Accuracy />
        <Terminal />
        <Cta onAnalyze={focusInput} onChooseFolder={() => folderInput.current?.click()} />
      </main>
      <Footer />

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
