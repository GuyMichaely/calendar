#!/usr/bin/env bun
/*
 * Converts a calendar backup from before the Agenda (prototype2) to its data model.
 * The app itself reads only the current model, and import refuses fields it doesn't know.
 *
 *   ./scripts/bun scripts/migrate-backup.js calendar-backup.json [converted.json]
 *
 * Then import the converted file (Settings → Data → Import backup). Importing updates
 * each item in place and removes the old fields from it.
 *
 * - sleep becomes pushed down (a sleep that has already ended is just dropped);
 * - inline working hours become named windows, one per distinct set of hours;
 * - an exact "warn at" time becomes a lead time in hours before the due date;
 * - a latest start becomes the due date when there's none (else it's dropped), and a
 *   dependent task's "latest start N days after starting" likewise;
 * - boards lose nesting (parentId), and their old board-page columns (boardColumn,
 *   sortOrder) become their place in the Boards view (layoutColumn, layoutRow).
 */
import { readFileSync, writeFileSync } from "node:fs";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeHours(days, start, end) {
  const runs = [];
  for (const day of days) {
    const run = runs.at(-1);
    if (run && run.at(-1) === day - 1) run.push(day); else runs.push([day]);
  }
  const dayText = days.length === 7 ? "Daily" : runs.map(run => run.length > 2 ? `${WEEKDAYS[run[0]]}–${WEEKDAYS[run.at(-1)]}` : run.map(day => WEEKDAYS[day]).join(", ")).join(", ");
  return `${dayText} ${start}–${end}`;
}

const without = (item, fields) => Object.fromEntries(Object.entries(item).filter(([field]) => !fields.includes(field)));

/** The converted items, and a count of each kind of change. */
export function convertItems(items, now = new Date()) {
  const at = now.toISOString();
  const counts = { pushedDown: 0, windows: 0, windowTasks: 0, warnHours: 0, latestStart: 0, boards: 0 };
  const windows = items.filter(item => item.kind === "window");
  const created = [];
  const windowFor = (days, start, end) => {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    const same = [...windows, ...created].find(window => window.start === start && window.end === end && [...window.days].sort((a, b) => a - b).join() === sorted.join());
    if (same) return same.id;
    const window = { id: `window-hours-${sorted.join("")}-${start.replace(":", "")}-${end.replace(":", "")}`, kind: "window", title: describeHours(sorted, start, end), days: sorted, start, end, createdAt: at, updatedAt: at };
    created.push(window);
    counts.windows++;
    return window.id;
  };

  // Boards not yet placed in the Boards view keep their old columns, between Available and Upcoming.
  const unplaced = items.filter(item => item.kind === "group" && !item.builtin && item.layoutColumn == null);
  const oldColumn = board => board.boardColumn ?? `own:${board.id}`;
  const columns = [...new Set([...unplaced].sort((a, b) => (a.boardColumn ?? Infinity) - (b.boardColumn ?? Infinity) || String(a.createdAt).localeCompare(String(b.createdAt))).map(oldColumn))];
  const placement = new Map();
  columns.forEach((key, index) => unplaced.filter(board => oldColumn(board) === key)
    .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .forEach((board, row) => placement.set(board.id, { layoutColumn: 2 + index, layoutRow: row })));

  const converted = items.map(item => {
    if (item.kind === "group") {
      if (!("parentId" in item) && !("boardColumn" in item) && !("boardOrder" in item) && !placement.has(item.id)) return item;
      counts.boards++;
      return { ...without(item, ["parentId", "boardColumn", "boardOrder"]), ...placement.get(item.id), ...(item.parentId || placement.has(item.id) ? { updatedAt: at } : {}) };
    }
    if (item.kind !== "task") return item;
    const legacy = ["sleep", "availabilitySchedule", "warnAt", "latestStart"];
    if (!legacy.some(field => field in item) && item.relativeDates?.latestStart === undefined) return item;
    const task = without(item, legacy);
    const until = item.sleep?.until ? new Date(item.sleep.until) : null;
    if (item.sleep && !item.pushedDown && item.state !== "completed" && (!until || until > now)) {
      task.pushedDown = { until: item.sleep.until, at: item.sleep.startedAt || at };
      counts.pushedDown++;
    }
    const hours = item.availabilitySchedule;
    if (hours?.enabled && !item.windowId && hours.days?.length && hours.start && hours.end) {
      task.windowId = windowFor(hours.days, hours.start, hours.end);
      counts.windowTasks++;
    }
    if (item.warnAt && item.deadline && !item.warnHours) {
      const lead = (new Date(item.deadline).getTime() - new Date(item.warnAt).getTime()) / 3_600_000;
      if (Number.isFinite(lead)) { task.warnHours = Math.max(1, Math.round(lead)); counts.warnHours++; }
    }
    if (item.latestStart && !item.deadline) { task.deadline = item.latestStart; counts.latestStart++; }
    if (item.relativeDates && item.relativeDates.latestStart !== undefined) {
      const { latestStart, ...rest } = item.relativeDates;
      task.relativeDates = { ...rest, ...(rest.deadline == null && latestStart != null ? { deadline: latestStart } : {}) };
    }
    // Only empty old fields: just drop them.
    if (legacy.some(field => item[field] != null) || item.relativeDates?.latestStart != null) task.updatedAt = at;
    return task;
  });
  return { items: [...created, ...converted], counts, changed: converted.filter((item, index) => item !== items[index]).length + created.length };
}

if (import.meta.main) {
  const [input, output = input.replace(/\.json$/i, "") + "-converted.json"] = process.argv.slice(2);
  if (!input) {
    console.error("Usage: ./scripts/bun scripts/migrate-backup.js <backup.json> [converted.json]");
    process.exit(1);
  }
  const backup = JSON.parse(readFileSync(input, "utf8"));
  if (!Array.isArray(backup?.items)) throw new Error("Expected a backup: an object with an items array.");
  const { items, counts, changed } = convertItems(backup.items);
  writeFileSync(output, JSON.stringify({ items }, null, 2));
  console.log(`Wrote ${output}: ${changed} of ${items.length} items changed.`);
  console.log(`  ${counts.pushedDown} sleeping tasks pushed down`);
  console.log(`  ${counts.windowTasks} tasks with working hours moved to ${counts.windows} new window(s)`);
  console.log(`  ${counts.warnHours} warn-at times turned into lead times`);
  console.log(`  ${counts.latestStart} latest starts turned into due dates`);
  console.log(`  ${counts.boards} boards flattened or placed`);
}
