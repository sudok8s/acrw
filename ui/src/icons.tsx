// ACRW line icons (16px grid, 1.5 stroke) and the raven mark, from the design system.
import type { CSSProperties } from "react";

export const IC = {
  overview: 'M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5h-4.5zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5h-4.5z',
  projects: 'M2 4.5h4l1.5 1.5h6.5v7h-12z',
  review: 'M5.5 4l-3.5 4 3.5 4M10.5 4l3.5 4-3.5 4',
  findings: 'M8 1.8l5.5 2v4.2c0 3.2-2.4 5.3-5.5 6.2-3.1-.9-5.5-3-5.5-6.2v-4.2z',
  scans: 'M8 8l4.2-4.2M13.5 8a5.5 5.5 0 1 1-1.6-3.9M10.6 8a2.6 2.6 0 1 1-.8-1.9',
  flow: 'M3.5 3.5h3v3h-3zM9.5 9.5h3v3h-3zM5 6.5v3.5h4.5',
  settings: 'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 1 0 0-4.8zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zM10.3 10.3l3.2 3.2',
  branch: 'M4.5 2.5v11M4.5 9.5c0-2.5 7-1.5 7-5M11.5 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z',
  file: 'M4 1.8h5l3 3v9.4h-8zM9 1.8v3h3',
  folder: 'M2 4h4l1.5 1.5h6.5v7.5h-12z',
  chevronRight: 'M6 3.5l4.5 4.5-4.5 4.5',
  chevronDown: 'M3.5 6l4.5 4.5 4.5-4.5',
  check: 'M3 8.5l3 3 7-7',
  x: 'M4 4l8 8M12 4l-8 8',
  alert: 'M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.01',
  info: 'M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 1 0 0-12.4zM8 7.2v4M8 5v.01',
  play: 'M5 3l8 5-8 5z',
  stop: 'M4 4h8v8h-8z',
  retry: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3',
  spinner: 'M8 2a6 6 0 1 1-6 6',
  assist: 'M2.5 3h11v7.5h-6l-3 2.5v-2.5h-2zM5.5 6.5h5',
  lock: 'M4 7h8v6.5h-8zM5.5 7v-2a2.5 2.5 0 0 1 5 0v2',
  sidebar: 'M2 2.5h12v11h-12zM6 2.5v11',
  split: 'M2 2.5h12v11h-12zM8 2.5v11',
  unified: 'M2 2.5h12v11h-12zM2 8h12',
  note: 'M3 2.5h10v8l-3 3h-7zM10 13.5v-3h3M5.5 6h5M5.5 8.5h3',
  signal: 'M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zM8 1v3.5M8 11.5v3.5M1 8h3.5M11.5 8h3.5',
  terminal: 'M2 3h12v10h-12zM4.5 6l2 2-2 2M8 10h3.5',
  plus: 'M8 3v10M3 8h10',
  expand: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  arrowRight: 'M3 8h10M9 4l4 4-4 4',
  ext: 'M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v4H2.5V4h4',
  repo: 'M3.5 2.5h9v11h-9zM3.5 11h9M6 2.5v5l1.25-1 1.25 1v-5',
  fullfile: 'M4 1.8h5l3 3v9.4h-8zM9 1.8v3h3M6 8.5h4M6 11h4',
  prev: 'M10 3.5L5.5 8l4.5 4.5',
  next: 'M6 3.5l4.5 4.5L6 12.5',
  collapseL: 'M2 2.5h12v11h-12zM6 2.5v11M11 6l-2 2 2 2',
  collapseR: 'M2 2.5h12v11h-12zM10 2.5v11M5 6l2 2-2 2',
  zoomIn: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zM10.3 10.3l3.2 3.2M5 7h4M7 5v4',
  zoomOut: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zM10.3 10.3l3.2 3.2M5 7h4',
  fit: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3',
  collapse: 'M4 10l4-4 4 4M4 14l4-4 4 4',
  sortUp: 'M8 13V3M4.5 6.5L8 3l3.5 3.5',
  sortDown: 'M8 3v10M4.5 9.5L8 13l3.5-3.5',
  key: 'M5.5 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5zM8 7.5h6M12 7.5v2.5',
  db: 'M3 4c0-1.1 2.2-2 5-2s5 .9 5 2v8c0 1.1-2.2 2-5 2s-5-.9-5-2zM3 4c0 1.1 2.2 2 5 2s5-.9 5-2M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
  clock: 'M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 1 0 0-12.4zM8 4.5V8l2.5 1.5',
  eye: 'M1.5 8c1.5-3 3.8-4.5 6.5-4.5s5 1.5 6.5 4.5c-1.5 3-3.8 4.5-6.5 4.5s-5-1.5-6.5-4.5zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 1 0 0-3.6z'
} as const;
export type IconName = keyof typeof IC;

const RAVEN = {
  body: 'M3 64 L5.5 45 L11 32 L19 22 L28.5 16 L37 13.5 L41 14 L43.2 15.4 L45 14.6 L45.8 16.6 L53.5 19.2 L60.5 23.6 L63.4 28.4 L60 27.6 L45 29.6 L43.2 30.4 L44.8 33.6 L41.6 34.2 L43.8 38 L40.2 38.6 L42.4 43 L38.6 43.6 L40.4 48.4 L37.2 49.6 L39.6 57 L44 64 Z',
  gape: 'M45.8 23.2 L59.8 26.4 L45.8 25.2 Z',
  cheek: 'M28 26 L44 22.8 L40 32 Z',
  hackle: 'M12 49 L31 36 L17 52 Z',
  eye: 'M36 18.6 L38.6 21.2 L36 23.8 L33.4 21.2 Z'
};

export function Icon({ name, size, className, style, spin, label }: { name: IconName; size?: 12 | 16; className?: string; style?: CSSProperties; spin?: boolean; label?: string }) {
  return (
    <svg className={"cw-icon" + (size === 12 ? " ic-12" : "") + (spin ? " cw-spin" : "") + (className ? " " + className : "")} viewBox="0 0 16 16"
      style={style} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      <path d={IC[name]} />
    </svg>
  );
}

export function RavenMark({ size = 26, mono }: { size?: number; mono?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="ACRW">
      {!mono && <rect width="64" height="64" rx="6" style={{ fill: "#92949D" }} />}
      <path d={RAVEN.body} style={{ fill: mono ? "currentColor" : "#101113" }} />
      <path d={RAVEN.gape} style={{ fill: mono ? "#101113" : "#92949D" }} />
      {!mono && <path d={RAVEN.cheek} style={{ fill: "#191A1E" }} />}
      {!mono && <path d={RAVEN.hackle} style={{ fill: "#292B30" }} />}
      <path d={RAVEN.eye} style={{ fill: mono ? "#101113" : "#C9283D" }} />
    </svg>
  );
}
