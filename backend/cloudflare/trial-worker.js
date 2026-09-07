// Isolated Free-plan performance trial. Never attach the production hostname.
import { CalendarStore as BackendStore } from "./worker.js";
export class TrialCalendarStore extends BackendStore {
  constructor(ctx, env) {
    // Sync-only trial: no R2 subscription or real attachment files required.
    super(ctx, { ...env, ATTACHMENTS: { get: async () => null } });
    ctx.blockConcurrencyWhile(async () => {
      if (!env.TRIAL_TOKEN) return;
      const expiresAt = Date.now() + 3600000;
      await ctx.storage.put("auth:auth:session:" + env.TRIAL_TOKEN, {
        value: { identity: { issuer: "https://accounts.google.com", subject: "trial" }, expiresAt },
        expiresAt,
      });
    });
  }
}
export default {
  fetch(request, env) {
    if (!env.TRIAL_TOKEN) return new Response("Trial is not configured", { status: 503 });
    const path = new URL(request.url).pathname;
    if (!["/healthz", "/sync"].includes(path)) return new Response("Not found", { status: 404 });
    return env.CALENDAR.get(env.CALENDAR.idFromName("synthetic-trial")).fetch(request);
  },
};
