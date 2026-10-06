// Local smoke test only. Production Wrangler configuration never imports this.
import { CalendarStore as ProductionCalendar, default as worker } from "../../backend/worker.js";
import { createCalendarDocument, saveCalendarDocument } from "../../sync/automerge-document.js";
export class CalendarStore extends ProductionCalendar {
  constructor(ctx, env) {
    super(ctx, env);
    // A calendar the server already had, as production's does.
    ctx.blockConcurrencyWhile(async () => {
      if (!ctx.storage.sql.exec("SELECT 1 FROM documents").toArray().length) {
        ctx.storage.sql.exec("INSERT INTO documents (id, bytes) VALUES (?, ?)", "calendar:primary", saveCalendarDocument(createCalendarDocument([{ id: "seed", kind: "task", title: "Existing backend" }])));
      }
    });
  }
}
export default worker;
