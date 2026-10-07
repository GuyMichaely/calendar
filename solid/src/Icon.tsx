import { For } from "solid-js";
const paths = {
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"],
  list: ["M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M16 2v4M8 2v4M3 10h18M8 14h2m4 0h2M8 17h2"],
  check: ["m5 12 4 4L19 6"],
  done: ["M21 11v1a9 9 0 1 1-5.3-8.2", "m9 11 3 3L22 4"],
  plus: ["M12 5v14M5 12h14"],
  search: ["M21 21l-4.5-4.5", "M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0"],
  settings: ["M4 7h16M4 17h16M8 4v6M16 14v6"],
  moon: ["M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"],
  arrow: ["M5 12h14m-5-5 5 5-5 5"],
  // Sync's states: a cloud open at the bottom for its mark (check, lock, cross), crossed out when there's no syncing.
  "cloud-check": ["M7 18H6a4 4 0 1 1 .5-8 6 6 0 0 1 11.8-1A4.5 4.5 0 0 1 19 18h-2", "m9 17 2 2 4-4"],
  "cloud-lock": ["M7 18H6a4 4 0 1 1 .5-8 6 6 0 0 1 11.8-1A4.5 4.5 0 0 1 19 18h-2", "M9.5 16h5v5h-5z", "M10.5 16v-1.5a1.5 1.5 0 0 1 3 0V16"],
  "cloud-x": ["M7 18H6a4 4 0 1 1 .5-8 6 6 0 0 1 11.8-1A4.5 4.5 0 0 1 19 18h-2", "m10 15 4 4m0-4-4 4"],
  "cloud-off": ["M6 18a4 4 0 1 1 .5-8 6 6 0 0 1 11.8-1A4.5 4.5 0 0 1 19 18Z", "M3 3l18 18"],
  "wifi-off": ["M12 20h.01", "M8.5 16.5a5 5 0 0 1 7 0", "M5 13a10 10 0 0 1 14 0", "M2 9.5a15 15 0 0 1 20 0", "M3 3l18 18"],
  refresh: ["M20 11a8 8 0 0 0-14.3-4.9L4 8", "M4 4v4h4", "M4 13a8 8 0 0 0 14.3 4.9L20 16", "M20 20v-4h-4"],
  alert: ["M12 3 2 21h20L12 3Z", "M12 9v5m0 3v.01"],
  compact: ["M4 6h16M4 12h16M4 18h16"],
  clock: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", "M12 7v5l3 2"],
  paperclip: ["m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8", "m7 13 7-7"],
  user: ["M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0", "M4 21v-2a8 8 0 0 1 16 0v2"],
} as const;
export type IconName = keyof typeof paths;
export function Icon(props: { name: IconName; size?: number }) {
  return <svg class="ui-icon" width={props.size || 20} height={props.size || 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><For each={paths[props.name]}>{path => <path d={path} />}</For></svg>;
}
