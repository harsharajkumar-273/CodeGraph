import type { LoadProgress } from '../sources/types';
import { IconCheck, IconLogo } from '../ui/icons';

const STEPS = ['Get the files', 'Parse the code', 'Link calls'] as const;

function stepOf(p: LoadProgress | null) {
  if (!p || p.phase === 'list' || p.phase === 'download' || p.phase === 'read') return 0;
  return p.done >= p.total && p.total > 0 ? 2 : 1;
}

export function Loading({ title, progress, onCancel }: { title: string; progress: LoadProgress | null; onCancel: () => void }) {
  const step = stepOf(progress);
  const determinate = !!progress && progress.total > 0 && progress.phase !== 'list' && step < 2;
  const pct = determinate ? Math.round((progress!.done / progress!.total) * 100) : 0;
  return (
    <div className="landing loading-screen">
      <header className="landing-top">
        <div className="brand">
          <IconLogo width={22} height={22} className="brand-logo" />
          <span>CodeGraph</span>
        </div>
      </header>
      <main className="landing-main loading-main" aria-live="polite">
        <h2>Analyzing {title}</h2>
        <div className={`bar${determinate ? '' : ' indeterminate'}`} role="progressbar" aria-valuenow={determinate ? pct : undefined} aria-valuemin={0} aria-valuemax={100}>
          <span style={determinate ? { width: `${pct}%` } : undefined} />
        </div>
        <p className="status">
          {progress?.message ?? 'Starting…'}
          {determinate && (
            <span className="muted">
              {' '}
              {progress!.done.toLocaleString()} of {progress!.total.toLocaleString()}
            </span>
          )}
        </p>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
              <span className="step-mark">{i < step ? <IconCheck width={12} height={12} /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </main>
    </div>
  );
}
