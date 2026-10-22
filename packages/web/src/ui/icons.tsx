import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const line = (p: P): P => ({ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...p });

export const IconLogo = (p: P) => (
  <svg {...line({ strokeWidth: 2, ...p })}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="18" cy="8" r="2.4" />
    <circle cx="12" cy="18" r="2.4" />
    <path d="M8.1 7l7.8.7M7.3 8l3.6 8M16.7 10l-3.5 6.2" />
  </svg>
);
export const IconSearch = (p: P) => (
  <svg {...line(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);
export const IconX = (p: P) => (
  <svg {...line(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconFolder = (p: P) => (
  <svg {...line(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);
export const IconFile = (p: P) => (
  <svg {...line(p)}>
    <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v4h4" />
  </svg>
);
export const IconChevron = (p: P) => (
  <svg {...line(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...line(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconUpload = (p: P) => (
  <svg {...line(p)}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);
export const IconExternal = (p: P) => (
  <svg {...line(p)}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </svg>
);
export const IconCopy = (p: P) => (
  <svg {...line(p)}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...line({ strokeWidth: 2.2, ...p })}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);
export const IconMenu = (p: P) => (
  <svg {...line(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const IconGithub = (p: P) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <path d="M12 .5a11.5 11.5 0 0 0-3.63 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
