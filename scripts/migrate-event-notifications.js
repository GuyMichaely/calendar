// Events and records notify only at the times in their Notify me at list: each one's "minutes
// before it starts" becomes an entry there (its start less those minutes), and the minutes go.
// It lists what it would change, and with --apply saves the calendar as it was under .local/,
// changes it, and syncs.
//
//   cloudflared access login https://calendar.guymichaely.com/sync
//   ./scripts/bun scripts/migrate-event-notifications.js            # list the changes
//   ./scripts/bun scripts/migrate-event-notifications.js --apply    # make them
import { deleteItemField, materializeItems, patchItem } from "../sync/automerge-document.js";
import { apply, openLiveCalendar } from "./live-calendar.js";

const calendar = await openLiveCalendar();
const changes = [];
for (const item of materializeItems(calendar.doc, { includeDeleted: true })) {
  if ((item.kind !== "event" && item.kind !== "record") || !("reminderMinutes" in item)) continue;
  const start = item.start ? new Date(item.start) : null;
  const at = item.reminderMinutes != null && start && !Number.isNaN(start.getTime()) ? new Date(start.getTime() - item.reminderMinutes * 60_000).toISOString() : null;
  const remindAt = at ? [...new Set([...(item.remindAt || []), at])].sort() : item.remindAt ?? null;
  changes.push({ item, remindAt, at });
}
if (!changes.length) { console.log("No event or record notifies by minutes before it starts."); process.exit(0); }
for (const { item, at } of changes) console.log(`  ${item.deletedAt ? "(deleted) " : ""}${item.title || item.id}: ${at ? `${item.reminderMinutes} min before → ${at}` : "no notification; the empty setting goes"}`);
if (!apply) { console.log("Run again with --apply to make these changes."); process.exit(0); }

console.log(`Saved the calendar as it was to ${calendar.keep("event-notifications")}.`);
for (const { item, remindAt } of changes) {
  let doc = patchItem(calendar.doc, item.id, { remindAt }, `Notify ${item.id} at its times`);
  doc = deleteItemField(doc, item.id, "reminderMinutes", `Remove ${item.id}'s minutes before`);
  calendar.change(doc);
}
await calendar.sync();
console.log(`Changed ${changes.length} item${changes.length === 1 ? "" : "s"} and synced.`);
