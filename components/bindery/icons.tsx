import type { ReactNode } from 'react';

/** Inline icons from the Bindery design (Lucide-style 24px strokes). */
const svg = (kids: ReactNode, size = 16, strokeWidth = 2) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {kids}
  </svg>
);

export const BI = {
  docs: (s?: number) =>
    svg(
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </>,
      s
    ),
  inbox: (s?: number) =>
    svg(
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </>,
      s
    ),
  settings: (s?: number) =>
    svg(
      <>
        <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
      </>,
      s
    ),
  upload: (s?: number) =>
    svg(
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m17 8-5-5-5 5" />
        <path d="M12 3v12" />
      </>,
      s
    ),
  search: (s?: number) =>
    svg(
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </>,
      s
    ),
  more: (s?: number) =>
    svg(
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>,
      s,
      2.6
    ),
  down: (s?: number) => svg(<path d="m6 9 6 6 6-6" />, s),
  right: (s?: number) => svg(<path d="m9 18 6-6-6-6" />, s),
  left: (s?: number) => svg(<path d="m15 18-6-6 6-6" />, s),
  arrowL: (s?: number) => svg(<path d="M19 12H5M11 19l-7-7 7-7" />, s),
  arrowR: (s?: number) => svg(<path d="M5 12h14M13 5l7 7-7 7" />, s),
  x: (s?: number) => svg(<path d="M18 6 6 18M6 6l12 12" />, s),
  check: (s?: number) => svg(<path d="m5 12 5 5L20 7" />, s, 2.4),
  plus: (s?: number) => svg(<path d="M12 5v14M5 12h14" />, s),
  share: (s?: number) =>
    svg(
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </>,
      s
    ),
  download: (s?: number) =>
    svg(
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m7 10 5 5 5-5" />
        <path d="M12 15V3" />
      </>,
      s
    ),
  trash: (s?: number) =>
    svg(
      <>
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </>,
      s
    ),
  link: (s?: number) =>
    svg(
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>,
      s
    ),
  wrench: (s?: number) =>
    svg(
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
      s
    ),
  retry: (s?: number) =>
    svg(
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </>,
      s
    ),
  comment: (s?: number) =>
    svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />, s),
  alert: (s?: number) =>
    svg(
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>,
      s
    ),
  xcircle: (s?: number) =>
    svg(
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6M9 9l6 6" />
      </>,
      s
    ),
  info: (s?: number) =>
    svg(
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </>,
      s
    ),
  lock: (s?: number) =>
    svg(
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>,
      s
    ),
  mail: (s?: number) =>
    svg(
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-10 5L2 7" />
      </>,
      s
    ),
  phone: (s?: number) =>
    svg(
      <>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M12 18h.01" />
      </>,
      s
    ),
  sun: (s?: number) =>
    svg(
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </>,
      s,
      1.8
    ),
  moon: (s?: number) => svg(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />, s, 1.8),
  signout: (s?: number) =>
    svg(
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </>,
      s
    ),
  palette: (s?: number) =>
    svg(
      <>
        <circle cx="13.5" cy="6.5" r="1.5" />
        <circle cx="17.5" cy="10.5" r="1.5" />
        <circle cx="8.5" cy="7.5" r="1.5" />
        <circle cx="6.5" cy="12.5" r="1.5" />
        <path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A5.7 5.7 0 0 0 22 9.7C22 5.4 17.5 2 12 2z" />
      </>,
      s
    ),
  branch: (s?: number) =>
    svg(
      <>
        <path d="M6 3v12" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </>,
      s
    ),
  clock: (s?: number) =>
    svg(
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </>,
      s
    ),
  grid: (s?: number) =>
    svg(
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </>,
      s
    ),
  zoomIn: (s?: number) =>
    svg(
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3M8 11h6M11 8v6" />
      </>,
      s
    ),
  zoomOut: (s?: number) =>
    svg(
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3M8 11h6" />
      </>,
      s
    ),
  fit: (s?: number) =>
    svg(
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
      s
    ),
  pen: (s?: number) => svg(<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />, s),
  text: (s?: number) => svg(<path d="M4 7V4h16v3M9 20h6M12 4v16" />, s),
  print: (s?: number) =>
    svg(
      <>
        <path d="M6 9V2h12v7" />
        <rect x="6" y="14" width="12" height="8" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      </>,
      s
    ),
  pinAdd: (s?: number) =>
    svg(
      <>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v6M9 10h6" />
      </>,
      s
    ),
  cmd: (s?: number) =>
    svg(
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />,
      s
    ),
  globe: (s?: number) =>
    svg(
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>,
      s
    ),
  // tools
  redact: (s?: number) =>
    svg(
      <>
        <rect x="3" y="5" width="11" height="5" rx="1" fill="currentColor" />
        <path d="M17 7.5h4M3 14h18M3 18.5h12" />
      </>,
      s
    ),
  ocr: (s?: number) =>
    svg(
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h8M7 12h10M7 16h6" />,
      s
    ),
  watermark: (s?: number) => svg(<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />, s),
  flatten: (s?: number) =>
    svg(
      <>
        <path d="m12 2 10 5-10 5L2 7z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </>,
      s
    ),
  merge: (s?: number) =>
    svg(
      <>
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M6 21V9a9 9 0 0 0 9 9" />
      </>,
      s
    ),
  split: (s?: number) =>
    svg(
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
      </>,
      s
    ),
  rotate: (s?: number) =>
    svg(
      <>
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </>,
      s
    ),
  pdfa: (s?: number) =>
    svg(
      <>
        <rect x="2" y="3" width="20" height="5" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
      </>,
      s
    ),
  linearize: (s?: number) => svg(<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />, s),
  compress: (s?: number) => svg(<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />, s),
  convert: (s?: number) => svg(<path d="m8 3-4 4 4 4M4 7h16M16 21l4-4-4-4M20 17H4" />, s),
  protect: (s?: number) =>
    svg(
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>,
      s
    ),
};
