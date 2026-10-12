// Notifications become lead times: each "at this moment" (remindAt) becomes how long before the
// item's start it is (a task's: before it can start, or before it's due, whichever it's nearer
// to), and each older "minutes before it starts" (reminderMinutes) is that. One with nothing it
// comes before (no such date, or after it) is listed and dropped. It lists what it would change,
// and with --apply saves the calendar as it was under .local/, changes it, and syncs.
//
//   cloudflared access login https://calendar.guymichaely.com/sync
//   ./scripts/bun scripts/migrate-relative-notifications.js            # list the changes
//   ./scripts/bun scripts/migrate-relative-notifications.js --apply    # make them
import { deleteItemField, materializeItems, patchItem } from "../sync/automerge-document.js";

const time = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.getTime() : null; };

/** An item's notifications as lead times, and the moments that came before nothing (dropped). */
export function leadTimes(item) {
  const anchors = item.kind === "task" ? [[time(item.availableFrom), null], [time(item.deadline), "due"]] : [[time(item.start), null]];
  const notices = new Map(), dropped = [];
  const keep = (minutes, of) => { const notice = of ? { minutes, of } : { minutes }; notices.set(JSON.stringify(notice), notice); };
  for (const at of item.remindAt || []) {
    const moment = time(at);
    // The nearest time it comes before (a can-start time over a due one, if it's as near).
    const [best] = anchors.filter(([anchor]) => anchor != null && moment != null && moment <= anchor).map(([anchor, of]) => [Math.round((anchor - moment) / 60_000), of]).sort((a, b) => a[0] - b[0]);
    if (best) keep(...best); else dropped.push(at);
  }
  if (item.kind !== "task" && item.reminderMinutes != null) keep(item.reminderMinutes, null);
  const list = [...notices.values()].sort((a, b) => b.minutes - a.minutes || (a.of ? 1 : 0) - (b.of ? 1 : 0));
  return { notifications: list.length ? list : null, dropped };
}

const describe = (notice) => `${notice.minutes} min before ${notice.of === "due" ? "it's due" : "it starts"}`;

if (import.meta.main) {
  const { apply, openLiveCalendar } = await import("./live-calendar.js");
  const calendar = await openLiveCalendar();
  const changes = materializeItems(calendar.doc, { includeDeleted: true })
    .filter(item => "remindAt" in item || "reminderMinutes" in item)
    .map(item => ({ item, ...leadTimes(item) }));
  if (!changes.length) { console.log("No item notifies at set moments."); process.exit(0); }
  for (const { item, notifications, dropped } of changes) {
    const kept = (notifications || []).map(describe).join(", ") || "none";
    console.log(`  ${item.deletedAt ? "(deleted) " : ""}${item.title || item.id}: ${kept}${dropped.length ? `; dropped (before nothing): ${dropped.join(", ")}` : ""}`);
  }
  if (!apply) { console.log("Run again with --apply to make these changes."); process.exit(0); }

  console.log(`Saved the calendar as it was to ${calendar.keep("relative-notifications")}.`);
  for (const { item, notifications } of changes) {
    let doc = patchItem(calendar.doc, item.id, { notifications }, `Notify ${item.id} some time before`);
    for (const field of ["remindAt", "reminderMinutes"]) if (field in item) doc = deleteItemField(doc, item.id, field, `Remove ${item.id}'s ${field}`);
    calendar.change(doc);
  }
  await calendar.sync();
  console.log(`Changed ${changes.length} item${changes.length === 1 ? "" : "s"} and synced.`);
}
