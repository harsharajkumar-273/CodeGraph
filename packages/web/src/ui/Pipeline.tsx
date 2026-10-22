import type { CSSProperties, ReactNode, SVGProps } from 'react';
import { IconCheck } from './icons';

type P = SVGProps<SVGSVGElement>;
const g = (p: P): P => ({ width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...p });

const IconSource = (p: P) => (
  <svg {...g(p)}>
    <path d="M4 7a2 2 0 0 1 2-2h4l2 2.2h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
    <path d="M12 11v5M9.5 13.5 12 16l2.5-2.5" />
  </svg>
);
const IconParse = (p: P) => (
  <svg {...g(p)}>
    <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 6l-3 12" />
  </svg>
);
const IconLink = (p: P) => (
  <svg {...g(p)}>
    <circle cx="6" cy="7" r="2.2" />
    <circle cx="18" cy="7" r="2.2" />
    <circle cx="12" cy="17.5" r="2.2" />
    <path d="M8 7.4h8M7.3 9l3.5 6.4M16.7 9l-3.5 6.4" />
  </svg>
);
const IconLabel = (p: P) => (
  <svg {...g(p)}>
    <path d="M12 3.5 5 6.2v5.1c0 4.2 2.8 7.4 7 9.2 4.2-1.8 7-5 7-9.2V6.2l-7-2.7Z" />
    <path d="m9 12 2.1 2.1L15.2 10" />
  </svg>
);
const IconImpact = (p: P) => (
  <svg {...g(p)}>
    <circle cx="9" cy="12" r="2" />
    <path d="M13.5 12H20M13.2 9l5.8-3M13.2 15l5.8 3" />
    <circle cx="20.2" cy="5.5" r="1" />
    <circle cx="21" cy="12" r="1" />
    <circle cx="20.2" cy="18.5" r="1" />
  </svg>
);

export interface Stage {
  id: string;
  title: string;
  text: string;
  /** A concrete example of what this stage produces. */
  sample: string;
  icon: ReactNode;
}

/** What happens between "here is a repository" and "here is what a change would break". */
export const STAGES: Stage[] = [
  { id: 'get', title: 'Get the code', text: 'A GitHub repository, a folder, loose files or a .zip. Read straight into your tab.', sample: 'pallets/flask · 83 files', icon: <IconSource /> },
  { id: 'parse', title: 'Parse it', text: 'Tree-sitter, compiled to WebAssembly, turns every file into a syntax tree in a background thread.', sample: '1,580 symbols found', icon: <IconParse /> },
  { id: 'link', title: 'Link it', text: 'Imports, calls, methods and type hints are followed across files to connect the pieces.', sample: '1,555 calls linked', icon: <IconLink /> },
  { id: 'label', title: 'Label every edge', text: 'Each link is marked resolved, probable or ambiguous, so a guess never looks like a fact.', sample: '52% proven · 48% flagged', icon: <IconLabel /> },
  { id: 'impact', title: 'Show the blast radius', text: 'Pick any function: see what could break, how sure we are, and which tests to run.', sample: '40 symbols · 8 tests', icon: <IconImpact /> },
];

/** Stages of a live analysis, shown while it runs. */
export const LIVE_STAGES: Pick<Stage, 'id' | 'title' | 'icon'>[] = [
  { id: 'get', title: 'Get the files', icon: <IconSource /> },
  { id: 'parse', title: 'Parse the code', icon: <IconParse /> },
  { id: 'link', title: 'Link the calls', icon: <IconLink /> },
  { id: 'ready', title: 'Ready', icon: <IconImpact /> },
];

/**
 * A row of stages joined by a track. `ambient` is the homepage explainer: a packet travels the track and each stage
 * lights up as it passes. `live` shows real progress: finished stages are ticked, the current one pulses and its
 * outgoing track fills with `progress` (0 to 1).
 */
export function Pipeline({
  stages,
  mode,
  current = 0,
  progress = 0,
  detail = true,
}: {
  stages: (Pick<Stage, 'id' | 'title' | 'icon'> & Partial<Stage>)[];
  mode: 'ambient' | 'live';
  current?: number;
  progress?: number;
  detail?: boolean;
}) {
  const n = stages.length;
  return (
    <ol className={`pipeline pipeline-${mode}`} style={{ '--n': n, '--span': Math.max(1, n - 1) } as CSSProperties}>
      {mode === 'ambient' && <span className="packet" aria-hidden />}
      {stages.map((s, i) => {
        const state = mode === 'live' ? (i < current ? 'done' : i === current ? 'now' : 'todo') : '';
        return (
          <li key={s.id} className={`stage ${state}`} style={{ '--i': i } as CSSProperties} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="stage-node">{state === 'done' ? <IconCheck width={20} height={20} /> : s.icon}</span>
            {i < n - 1 && (
              <span className="stage-link" aria-hidden>
                <i style={mode === 'live' ? { width: `${Math.round((i < current ? 1 : i === current ? progress : 0) * 100)}%` } : undefined} />
              </span>
            )}
            <h3 className="stage-title">{s.title}</h3>
            {detail && s.text && <p className="stage-text">{s.text}</p>}
            {detail && s.sample && <code className="stage-sample">{s.sample}</code>}
          </li>
        );
      })}
    </ol>
  );
}
