import type { Group, Item, Task, TimeWindow } from "./types";

/*
 * Sample calendar for trying the Today view locally: one set mixing ordinary tasks with
 * subtasks that sit beside their parent, in a different section, or several levels
 * deep. Times are relative to now so every section has entries.
 */
export function demoItems(now = new Date()): Item[] {
  const created = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const hours = (count: number) => new Date(now.getTime() + count * 3_600_000).toISOString();
  const days = (count: number) => { const date = new Date(now); date.setDate(date.getDate() + count); date.setHours(9, 0, 0, 0); return date.toISOString(); };
  // "HH:MM" some hours from now, kept within today.
  const hhmm = (offset: number) => {
    const minutes = Math.max(0, Math.min(23 * 60 + 59, Math.round((now.getHours() * 60 + now.getMinutes() + offset * 60) / 30) * 30));
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };
  const window = (id: string, title: string, dayList: number[], start: string, end: string): TimeWindow => ({ id, kind: "window", title, days: dayList, start, end, createdAt: created, updatedAt: created });
  const group = (id: string, title: string, parentId: string | null = null): Group => ({ id, kind: "group", title, parentId, sortOrder: 0, createdAt: created, updatedAt: created });
  let order = 0;
  const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
    id, kind: "task", title, state: "open", notes: "", tags: [], attachments: [], sortOrder: order++,
    createdAt: created, updatedAt: created, history: [{ at: created, type: "created" }], ...extra,
  });
  const every = [0, 1, 2, 3, 4, 5, 6];
  return [
    window("demo-business", "Business hours", [1, 2, 3, 4, 5], "09:00", "17:00"),
    window("demo-pharmacy", "Pharmacy counter", every, hhmm(-1), hhmm(2)),
    window("demo-support", "Support line", every, hhmm(3), hhmm(5)),
    group("demo-finances", "Finances"), group("demo-home", "Home"), group("demo-health", "Health"),
    group("demo-jobs", "Jobs"), group("demo-learning", "Learning"),

    // Ordinary tasks, one of each kind of timing.
    task("demo-card", "Pay credit card", { groupId: "demo-finances", deadline: hours(20) }),
    task("demo-registration", "Renew car registration", { groupId: "demo-home", deadline: days(-1) }),
    task("demo-refill", "Call pharmacy about refill", { groupId: "demo-health", windowId: "demo-pharmacy", takes: 15 }),
    task("demo-dispute", "Dispute charge with bank", { groupId: "demo-finances", windowId: "demo-business", takes: 60 }),
    task("demo-isp", "Call internet provider support", { groupId: "demo-home", windowId: "demo-support", takes: 30 }),
    task("demo-balance", "Check credit balance", { groupId: "demo-finances", notes: "Requested a refund of the credit balance; it should show by the 9th." }),
    task("demo-followup", "Call to follow up on refund", { groupId: "demo-finances", dependentOf: "demo-balance", windowId: "demo-business", relativeDates: { deadline: 2 } }),
    task("demo-mail", "Check the mail", { groupId: "demo-home" }),
    task("demo-photos", "Reorganize photos", { groupId: "demo-home", pushedDown: { until: null, at: created } }),
    task("demo-goggles", "Buy new swim goggles", { groupId: "demo-home", anytime: true }),
    task("demo-reading", "Read about index funds", { groupId: "demo-learning", anytime: true }),
    task("demo-dentist", "Schedule dentist cleaning", { groupId: "demo-health", availableFrom: days(3) }),
    task("demo-cover", "Draft cover letter", { groupId: "demo-jobs", takes: 120, deadline: days(5) }),

    // Subtasks in the same section as their parent: they nest as usual.
    task("demo-dinner", "Plan birthday dinner", { groupId: "demo-home" }),
    task("demo-restaurant", "Pick a restaurant", { parentId: "demo-dinner" }),
    task("demo-invites", "Send invites", { parentId: "demo-dinner" }),

    // Siblings spread across sections: the parent shows as context wherever they land.
    task("demo-passport", "Renew passport", { groupId: "demo-home" }),
    task("demo-form", "Fill out form DS-82", { parentId: "demo-passport" }),
    task("demo-photo", "Get passport photos", { parentId: "demo-passport", windowId: "demo-pharmacy", takes: 20 }),
    task("demo-mail-form", "Mail the application", { parentId: "demo-passport", availableFrom: days(2) }),

    // A deep chain: the grandchild is due soon, so it shows under Firm with two context rows.
    task("demo-move", "Apartment move", { groupId: "demo-home" }),
    task("demo-utilities", "Sort out utilities", { parentId: "demo-move", availableFrom: days(4) }),
    task("demo-cancel", "Cancel old internet plan", { parentId: "demo-utilities", deadline: hours(10) }),
  ];
}
