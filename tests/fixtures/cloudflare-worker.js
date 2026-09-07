// Local smoke test only. Production Wrangler configuration never imports this.
import { CalendarStore as ProductionCalendar, default as worker } from "../../backend/cloudflare/worker.js";
import { createCalendarDocument, saveCalendarDocument } from "../../sync/automerge-document.js";
export class CalendarStore extends ProductionCalendar {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      await env.ATTACHMENTS.put("__initial_calendar.automerge", saveCalendarDocument(createCalendarDocument([{ id: "seed", kind: "task", title: "Existing backend" }])));
      await ctx.storage.put("auth:auth:session:local-test", {
      value: { identity: { issuer: "https://accounts.google.com", subject: "test" }, expiresAt: Date.now() + 60000 },
      expiresAt: Date.now() + 60000,
    });
    });
  }
}
export default worker;
