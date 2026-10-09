// Takes out of the synced calendar whatever this version of the app no longer uses: fields an
// older version stored on items (a task's own Deadline lead, say) that nothing reads any more.
// It lists what it would remove, and with --apply saves the calendar as it was under .local/,
// removes them, and syncs; every device then gets the change as usual.
//
//   cloudflared access login https://calendar.guymichaely.com/sync
//   ./scripts/bun scripts/clean-live-data.js            # list what would go
//   ./scripts/bun scripts/clean-live-data.js --apply    # remove it
//
// --endpoint <url> syncs with another server (see live-calendar.js).
import { deleteItemField, materializeItems } from "../sync/automerge-document.js";
import { allowedFieldsForKind } from "../site/automerge-storage.js";
import { apply, openLiveCalendar } from "./live-calendar.js";

const calendar = await openLiveCalendar();
const items = materializeItems(calendar.doc, { includeDeleted: true });
console.log(`${items.length} items synced.`);

const unused = [];
for (const item of items) {
  let allowed;
  try { allowed = allowedFieldsForKind(item.kind); }
  catch { console.log(`  ${item.id}: a kind this version doesn't know (${item.kind}); left as it is`); continue; }
  for (const field of Object.keys(item)) if (!allowed.has(field)) unused.push({ item, field });
}
if (!unused.length) { console.log("Nothing to remove."); process.exit(0); }

const byField = Object.groupBy(unused, entry => `${entry.item.kind}.${entry.field}`);
for (const [field, entries] of Object.entries(byField)) console.log(`  ${field}: on ${entries.length} item${entries.length === 1 ? "" : "s"}`);
if (!apply) { console.log("Run again with --apply to remove them."); process.exit(0); }

console.log(`Saved the calendar as it was to ${calendar.keep("clean")}.`);
for (const { item, field } of unused) calendar.change(deleteItemField(calendar.doc, item.id, field, `Remove ${field}, which this version doesn't use`));
await calendar.sync();
console.log(`Removed ${unused.length} unused field${unused.length === 1 ? "" : "s"} and synced.`);
