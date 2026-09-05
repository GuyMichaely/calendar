import { DurableObject } from "cloudflare:workers";
import { createCloudflareCalendarHandler } from "./handler.js";

export class CalendarState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.handleRequest = createCloudflareCalendarHandler({
      storage: this.ctx.storage,
      env: this.env,
    });
  }

  fetch(request) {
    return this.handleRequest(request);
  }
}

export default {
  fetch(request, env) {
    const state = env.CALENDAR_STATE.getByName("primary");
    return state.fetch(request);
  },
};
