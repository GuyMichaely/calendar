import { storageKey } from "../../site/storage-scope.js";
export const PREVIEW_CLOCK_KEY = storageKey("previewClock");
export function readPreviewTime(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
// A day step preserves local clock time across daylight-saving changes.
export function shiftPreviewTime(now: Date, hours: number) {
  const result = new Date(now);
  if (Math.abs(hours) === 24) result.setDate(result.getDate() + hours / 24);
  else result.setHours(result.getHours() + hours);
  return result;
}
