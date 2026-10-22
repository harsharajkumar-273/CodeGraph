import type { LoadProgress } from '../sources/types';
import { IconLogo } from '../ui/icons';
import { LIVE_STAGES, Pipeline } from '../ui/Pipeline';
import './landing/landing.css';

/** Which pipeline stage a progress report belongs to, and how far through it we are. */
function where(p: LoadProgress | null): { current: number; progress: number; determinate: boolean } {
  if (!p || p.phase === 'list') return { current: 0, progress: 0, determinate: false };
  const frac = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  if (p.phase === 'download' || p.phase === 'read') return { current: 0, progress: frac, determinate: p.total > 0 };
  // Parsing reaches 100% before the calls are linked, and linking has no count of its own.
  return p.done >= p.total && p.total > 0 ? { current: 2, progress: 0.5, determinate: false } : { current: 1, progress: frac, determinate: true };
}

export function Loading({ title, progress, onCancel }: { title: string; progress: LoadProgress | null; onCancel: () => void }) {
  const { current, progress: frac, determinate } = where(progress);
  const pct = Math.round(frac * 100);
  return (
    <div className="site loading-screen">
      <div className="loading-top">
        <span className="brand">
          <IconLogo width={22} height={22} className="brand-logo" />
          <span>CodeGraph</span>
        </span>
      </div>
      <main className="loading-main" aria-live="polite">
        <h2>Analyzing {title}</h2>
        <Pipeline stages={LIVE_STAGES} mode="live" current={current} progress={frac} detail={false} />
        <div className={`bar${determinate ? '' : ' indeterminate'}`} role="progressbar" aria-valuenow={determinate ? pct : undefined} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
          <span style={determinate ? { width: `${pct}%` } : undefined} />
        </div>
        <p className="status">
          {progress?.message ?? 'Starting…'}
          {determinate && progress && progress.total > 0 && (
            <span className="muted">
              {' '}
              {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
            </span>
          )}
        </p>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <p className="tip">When it's ready, press / to search for any function, class or file.</p>
      </main>
    </div>
  );
}
