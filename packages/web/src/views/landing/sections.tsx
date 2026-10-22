import { useState, type CSSProperties, type ReactNode } from 'react';
import { Reveal, useInView } from '../../hooks';
import { IconArrowRight, IconCheck, IconCopy, IconGithub, IconLogo } from '../../ui/icons';
import { Pipeline, STAGES } from '../../ui/Pipeline';

export const REPO_URL = 'https://github.com/harsharajkumar-273/CodeGraph';
export const EVAL_URL = `${REPO_URL}/blob/main/docs/ORACLE-EVAL.md`;
export const NPM_URL = 'https://www.npmjs.com/package/codegraph-engine';

const Section = ({ id, kicker, title, sub, children }: { id: string; kicker: string; title: ReactNode; sub?: ReactNode; children: ReactNode }) => (
  <section id={id} className="section" aria-labelledby={`${id}-title`}>
    <div className="wrap">
      <Reveal className="section-head">
        <span className="kicker">{kicker}</span>
        <h2 id={`${id}-title`}>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
      </Reveal>
      {children}
    </div>
  </section>
);

export function Nav({ onAnalyze }: { onAnalyze: () => void }) {
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a className="brand" href="#top" aria-label="CodeGraph home">
          <IconLogo width={22} height={22} className="brand-logo" />
          <span>CodeGraph</span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#accuracy">Accuracy</a>
          <a href="#cli">Terminal</a>
        </nav>
        <div className="nav-actions">
          <a className="nav-icon" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="CodeGraph on GitHub">
            <IconGithub width={18} height={18} />
          </a>
          <button type="button" className="primary sm" onClick={onAnalyze}>
            Analyze a repo <IconArrowRight width={15} height={15} />
          </button>
        </div>
      </div>
    </header>
  );
}

/** The product, as it looks after analyzing a real repository (captured from the app itself). */
export function Preview() {
  return (
    <section className="preview wrap" aria-label="A screenshot of CodeGraph showing the blast radius of url_for() in Flask">
      <Reveal>
        <figure className="browser">
          <div className="browser-bar" aria-hidden>
            <i />
            <i />
            <i />
            <span>codegraph · pallets/flask · url_for()</span>
          </div>
          <img src="/preview.jpg" width={1440} height={900} alt="CodeGraph's blast radius for url_for() in Flask: 40 symbols in 19 files could break, with the affected test files folded together and a panel listing each caller." decoding="async" />
        </figure>
        <p className="preview-caption">
          <b>40 symbols in 19 files</b> could break if Flask's <code>url_for()</code> changes, and <b>8 test files</b> to run. Every link says how it was found.
        </p>
      </Reveal>
    </section>
  );
}

export function HowItWorks() {
  return (
    <Section
      id="how"
      kicker="How it works"
      title={
        <>
          From a repository to a blast radius, <span className="grad">in five steps</span>
        </>
      }
      sub="The whole pipeline runs in your browser tab. The example numbers below are from a real run on Flask."
    >
      <Reveal delay={120}>
        <Pipeline stages={STAGES} mode="ambient" />
      </Reveal>
      <Reveal delay={200}>
        <p className="pipeline-note">
          <IconCheck width={16} height={16} /> Nothing is uploaded. Parsing happens in WebAssembly on a background thread, so the page stays responsive even for repositories with thousands of files.
        </p>
      </Reveal>
    </Section>
  );
}

const FEATURES: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: 'Blast radius, hop by hop',
    text: 'Pick any function, class or file. See everything that calls it, directly and indirectly, and how far a change could travel.',
    icon: <path d="M12 12h8M12 12 18 6M12 12l6 6M12 12H4" />,
  },
  {
    title: 'Honest about what it knows',
    text: 'Every link is labelled resolved, probable or ambiguous. Filter to what you trust, and see how much of an answer is proven.',
    icon: <path d="M12 3.5 5 6.2v5.1c0 4.2 2.8 7.4 7 9.2 4.2-1.8 7-5 7-9.2V6.2l-7-2.7ZM9 12l2.1 2.1L15.2 10" />,
  },
  {
    title: 'Tells you which tests to run',
    text: 'Test files that reach a change are listed, and a hundred test functions fold into one card per file so they never bury the code.',
    icon: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M8 15h8" />,
  },
  {
    title: 'Private by design',
    text: 'Your code is parsed in your own browser. For GitHub repositories the files go from GitHub to your tab and nowhere else.',
    icon: <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />,
  },
  {
    title: 'Bring your own code',
    text: 'A public GitHub repository, a folder, a few files, or a .zip. TypeScript, JavaScript, Python and Go, in one graph.',
    icon: <path d="M4 7a2 2 0 0 1 2-2h4l2 2.2h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7ZM12 11v5M9.5 13.5 12 16l2.5-2.5" />,
  },
  {
    title: 'Lives in your terminal and CI',
    text: 'The same engine ships as a CLI. Ask what a pull request could break with one command, and gate a merge on it.',
    icon: <path d="m5 8 4 4-4 4M12 17h7" />,
  },
];

export function Features() {
  return (
    <Section id="features" kicker="Features" title={<>Built to be trusted, not just fast</>} sub="Most call-graph tools give you a picture. CodeGraph tells you what to do about it, and how sure it is.">
      <div className="features">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 90} className="feature-wrap">
            <article className="feature">
              <span className="feature-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {f.icon}
                </svg>
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

interface Row {
  label: 'resolved' | 'probable' | 'ambiguous' | 'found';
  value: number;
  note: string;
}
const TS_ROWS: Row[] = [
  { label: 'resolved', value: 98, note: 'proven through imports and scope' },
  { label: 'probable', value: 69, note: 'one plausible name match nearby' },
  { label: 'ambiguous', value: 35, note: 'several candidates share the name' },
];
const PY_ROWS: Row[] = [
  { label: 'resolved', value: 99.8, note: 'proven through imports and scope' },
  { label: 'probable', value: 80, note: 'one plausible name match nearby' },
  { label: 'ambiguous', value: 16, note: 'several candidates share the name' },
];

const GO_ROWS: Row[] = [
  { label: 'resolved', value: 100, note: 'every link follows the types' },
  { label: 'found', value: 98.5, note: 'of the calls the Go type checker resolves' },
];

function Panel({ title, oracle, repos, rows }: { title: string; oracle: string; repos: string; rows: Row[] }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`panel${seen ? ' in' : ''}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <span>checked against {oracle}</span>
      </div>
      <ul className="meters">
        {rows.map((r, i) => (
          <li key={r.label} style={{ '--w': `${r.value}%`, '--delay': `${i * 140 + 120}ms` } as CSSProperties}>
            <div className="meter-row">
              <span className={`meter-label t-${r.label}`}>{r.label}</span>
              <span className="meter-value">{r.value}%</span>
            </div>
            <div className="meter" role="img" aria-label={r.label === 'found' ? `${r.value}% of the calls were found` : `${r.value}% of ${r.label} links were correct`}>
              <i className={`m-${r.label}`} />
            </div>
            <small>{r.note}</small>
          </li>
        ))}
      </ul>
      <p className="panel-foot">{repos}</p>
    </div>
  );
}

export function Accuracy() {
  return (
    <Section
      id="accuracy"
      kicker="Accuracy"
      title={
        <>
          Measured, <span className="grad">not claimed</span>
        </>
      }
      sub="We checked every call in ten open-source repositories against tools that know the right answer, and publish the numbers, including the weak ones."
    >
      <div className="panels">
        <Reveal>
          <Panel title="TypeScript" oracle="the TypeScript compiler" repos="Hono, Immer and NestJS: 23,860 correct links found" rows={TS_ROWS} />
        </Reveal>
        <Reveal delay={120}>
          <Panel title="Python" oracle="Jedi" repos="Requests, HTTPX and Rich: 9,067 correct links found" rows={PY_ROWS} />
        </Reveal>
        <Reveal delay={240}>
          <Panel title="Go" oracle="the Go type checker" repos="Cobra, Gin, Logrus and mux: 7,550 correct links found" rows={GO_ROWS} />
        </Reveal>
      </div>
      <Reveal delay={160}>
        <p className="accuracy-note">
          <b>Trust resolved. Treat probable as a lead to check and ambiguous as a list of name matches.</b> The repositories were chosen before measuring, but fixes the checks prompted are included, so on code you bring the numbers may be a little lower. Dynamic dispatch, dependency-injection containers and monkey-patching are still blind spots. <a href={EVAL_URL} target="_blank" rel="noreferrer">Read the full evaluation</a>.
        </p>
      </Reveal>
    </Section>
  );
}

const CLI_COMMANDS = ['npm install -g codegraph-engine', 'codegraph index pallets/flask', 'codegraph impact "Flask.url_for" --repo flask', 'codegraph impact --diff --range main...HEAD'];

export function Terminal() {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(CLI_COMMANDS.join('\n')).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)));
  return (
    <Section id="cli" kicker="Terminal and CI" title="The same engine, in your terminal" sub="Index a repository, ask what a symbol touches, or ask what a pull request could break, and use the answer in CI.">
      <Reveal delay={100}>
        <div className="terminal">
          <div className="terminal-bar">
            <span>~/code</span>
            <button type="button" className="icon-btn sm" onClick={copy} aria-label="Copy the commands" title="Copy">
              {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
            </button>
          </div>
          <pre tabIndex={0} aria-label="Example commands">
            <code>
              <span className="t-dim"># install once</span>
              {'\n'}
              <span className="t-prompt">$</span> {CLI_COMMANDS[0]}
              {'\n\n'}
              <span className="t-dim"># map a repository</span>
              {'\n'}
              <span className="t-prompt">$</span> {CLI_COMMANDS[1]}
              {'\n\n'}
              <span className="t-dim"># what breaks if this changes?</span>
              {'\n'}
              <span className="t-prompt">$</span> {CLI_COMMANDS[2]}
              {'\n\n'}
              <span className="t-dim"># what could this pull request break?</span>
              {'\n'}
              <span className="t-prompt">$</span> {CLI_COMMANDS[3]}
              {'\n'}
              <span className="t-out">Impact   3 symbols in 6 files  (3 resolved · 0 probable · 0 ambiguous)</span>
            </code>
          </pre>
        </div>
      </Reveal>
    </Section>
  );
}

export function Cta({ onAnalyze, onChooseFolder }: { onAnalyze: () => void; onChooseFolder: () => void }) {
  return (
    <section className="section cta-section" aria-labelledby="cta-title">
      <div className="wrap">
        <Reveal>
          <div className="cta">
            <h2 id="cta-title">Try it on code you know</h2>
            <p>Pick a repository you work on and see what its riskiest functions are. It takes a few seconds, and nothing leaves your browser.</p>
            <div className="cta-actions">
              <button type="button" className="primary" onClick={onAnalyze}>
                Analyze a repository <IconArrowRight />
              </button>
              <button type="button" className="ghost" onClick={onChooseFolder}>
                Choose a folder
              </button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-in">
        <div className="footer-brand">
          <span className="brand">
            <IconLogo width={20} height={20} className="brand-logo" />
            <span>CodeGraph</span>
          </span>
          <p>See what breaks before you change it.</p>
        </div>
        <nav aria-label="Project links">
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={NPM_URL} target="_blank" rel="noreferrer">npm</a>
          <a href={EVAL_URL} target="_blank" rel="noreferrer">Evaluation</a>
          <a href={`${REPO_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">Changelog</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT license</a>
        </nav>
      </div>
    </footer>
  );
}
