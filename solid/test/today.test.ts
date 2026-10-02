import { expect, test } from "bun:test";
import { buildSections, placeTask, pushedDownInfo, taskGroupId, warnTime, type Section } from "../src/today";
import { describeSchedule, nextOpening } from "../src/windows";
import type { Item, Task, TimeWindow } from "../src/types";

const at = "2026-09-01T00:00:00.000Z";
// Tuesday, Oct 6 2026, 2:20 pm local time.
const now = new Date(2026, 9, 6, 14, 20);
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).toISOString();
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, kind: "task", title: id, state: "open", createdAt: at, updatedAt: at, ...extra });
const window = (id: string, days: number[], start: string, end: string): TimeWindow => ({ id, kind: "window", title: id, days, start, end, createdAt: at, updatedAt: at });
const business = window("business", [1, 2, 3, 4, 5], "09:00", "17:00");
const evening = window("evening", [0, 1, 2, 3, 4, 5, 6], "18:00", "22:00");
const windows = new Map([business, evening].map(entry => [entry.id, entry]));
const section = (item: Task) => placeTask(item, now, windows).section;

test("a due task is firm from its warning time, 24 hours before by default", () => {
  expect(section(task("a", { deadline: local(7, 14, 0) }))).toBe("firm");
  expect(section(task("b", { deadline: local(7, 15, 0) }))).toBe("available");
  // A lead time of its own.
  expect(section(task("c", { deadline: local(9, 12), warnHours: 72 }))).toBe("firm");
  expect(section(task("c2", { deadline: local(9, 12), warnHours: 48 }))).toBe("available");
  expect(warnTime(task("d", { deadline: local(9, 12) }))?.toISOString()).toBe(local(8, 12));
  expect(placeTask(task("e", { deadline: local(5, 12) }), now, windows)).toMatchObject({ section: "firm", overdue: true });
});

test("windows place tasks by today's opening", () => {
  expect(placeTask(task("a", { windowId: "business" }), now, windows)).toMatchObject({ section: "closing", closes: new Date(local(6, 17)) });
  expect(placeTask(task("b", { windowId: "evening" }), now, windows)).toMatchObject({ section: "later", opens: new Date(local(6, 18)) });
  // Can't start until tomorrow: the next business-hours opening.
  expect(placeTask(task("c", { windowId: "business", availableFrom: local(7, 8) }), now, windows)).toMatchObject({ section: "upcoming", next: new Date(local(7, 9)) });
  // Starting partway through today's window.
  expect(placeTask(task("d", { windowId: "business", availableFrom: local(6, 15) }), now, windows)).toMatchObject({ section: "later", opens: new Date(local(6, 15)) });
});

test("can-start dates and pushed-down tasks", () => {
  expect(section(task("a", { availableFrom: local(6, 16) }))).toBe("later");
  expect(section(task("b", { availableFrom: local(8, 9) }))).toBe("upcoming");
  expect(section(task("d"))).toBe("available");
  expect(pushedDownInfo(task("e", { pushedDown: { until: null, at } }), now).pushed).toBe(true);
  expect(pushedDownInfo(task("f", { pushedDown: { until: local(6, 12), at } }), now).pushed).toBe(false);
});

test("windows describe themselves and find their next opening", () => {
  expect(describeSchedule(business)).toBe("Mon–Fri 09:00–17:00");
  expect(describeSchedule(evening)).toBe("Daily 18:00–22:00");
  expect(describeSchedule(window("x", [1, 3], "10:00", "11:00"))).toBe("Mon, Wed 10:00–11:00");
  // Friday evening: next business opening is Monday.
  expect(nextOpening(business, new Date(2026, 9, 9, 18))?.opens).toEqual(new Date(local(12, 9)));
});

// "(x)" is a container header and "~x" a muted row.
const shape = (sections: Section[]) => Object.fromEntries(sections.map(entry => [entry.id, entry.trees.map(function show(node): unknown {
  const label = node.container ? `(${node.task.id})` : node.muted ? `~${node.task.id}` : node.task.id;
  return node.children.length ? [label, node.children.map(show)] : label;
})]));
const all = { showCompleted: false, include: () => true };

test("a task with open subtasks is a container: placed only through its subtasks, in either setting", () => {
  const items: Item[] = [business,
    task("parent", { sortOrder: 0 }),
    task("child-now", { parentId: "parent", sortOrder: 0 }),
    task("child-window", { parentId: "parent", windowId: "business" }),
    task("grand-child", { parentId: "child-window", deadline: local(7, 9) }),
    task("solo", { sortOrder: 1 }),
  ];
  const spread = buildSections(items, now, { ...all, mode: "context" });
  expect(shape(spread)).toEqual({ firm: [["(parent)", [["(child-window)", ["grand-child"]]]]], available: [["(parent)", ["child-now"]], "solo"] });
  const together = buildSections(items, now, { ...all, mode: "nested" });
  // The family goes to its most urgent section (the grandchild's Firm); less urgent tasks are dimmed.
  // (The branch with a due task comes first.)
  expect(shape(together)).toEqual({ firm: [["(parent)", [["(child-window)", ["grand-child"]], "~child-now"]]], available: ["solo"] });
  expect(together.find(entry => entry.id === "firm")!.count).toBe(1);
});

test("a container's due date, start, window, and push-down pass down to its subtasks", () => {
  const items: Item[] = [business,
    task("house", { deadline: local(7, 9) }), task("room", { parentId: "house" }),
    task("later", { availableFrom: local(9, 9) }), task("step", { parentId: "later" }),
    task("calls", { windowId: "business" }), task("call", { parentId: "calls" }),
    task("someday", { pushedDown: { until: null, at } }), task("idea", { parentId: "someday" }),
  ];
  const place = (id: string) => buildSections(items, now, { ...all, mode: "context" }).find(entry => entry.trees.some(function has(node): boolean { return node.task.id === id || node.children.some(has); }))?.id;
  expect(["room", "step", "call", "idea"].map(place)).toEqual(["firm", "upcoming", "closing", "available"]);
  const idea = buildSections(items, now, { ...all, mode: "context" }).find(entry => entry.id === "available")!.trees.find(node => node.task.id === "someday")!.children[0];
  expect(idea.placement!.pushed).toBe(true);
});

test("finishing a parent takes its open subtasks with it", () => {
  const items: Item[] = [task("done", { state: "completed", completedAt: at }), task("left", { parentId: "done" })];
  expect(shape(buildSections(items, now, { ...all, mode: "context" }))).toEqual({});
  for (const mode of ["context", "nested"] as const) expect(shape(buildSections(items, now, { ...all, showCompleted: true, mode }))).toEqual({ completed: [["done", ["left"]]] });
});

test("an open task's finished subtasks go with it, folded unless it says to show them", () => {
  const items: Item[] = [task("parent"), task("finished", { parentId: "parent", state: "completed", completedAt: at }), task("open", { parentId: "parent" })];
  for (const mode of ["context", "nested"] as const) {
    const [section] = buildSections(items, now, { ...all, showCompleted: true, mode });
    expect(section.id).toBe("available");
    expect(section.trees[0].finished!.map(node => node.task.id)).toEqual(["finished"]);
    expect(section.trees[0].showFinished).toBe(false);
  }
  const shown = items.map(item => item.id === "parent" ? { ...item, completedSubtasks: "show" as const } : item);
  expect(buildSections(shown, now, { ...all, mode: "context" })[0].trees[0].showFinished).toBe(true);
});

test("the subtask samples differ between the two settings as their notes describe", async () => {
  const { sampleSubtaskItems } = await import("../src/demo-data");
  const items = sampleSubtaskItems(now);
  const titles = (sections: Section[]) => Object.fromEntries(sections.map(entry => [entry.id, entry.trees.map(function flat(node): string[] {
    const label = node.container ? `(${node.task.title})` : node.muted ? `~${node.task.title}` : node.task.title;
    return [label, ...node.children.flatMap(flat)];
  }).flat()]));
  const firm = ["(Apartment move)", "(Sort out utilities)", "Cancel old internet plan", "(Clean the house)", "Clean my room", "Clean the kitchen", "Pay phone bill"];
  expect(titles(buildSections(items, now, { ...all, mode: "context" }))).toEqual({
    firm,
    closing: ["(Renew passport)", "Get passport photos"],
    available: ["(Plan birthday dinner)", "Pick a restaurant", "Send invites", "(Renew passport)", "Fill out form DS-82", "(File tax return)", "Gather W-2s", "Water the plants"],
    upcoming: ["(Renew passport)", "Mail the application", "(File tax return)", "File the return"],
  });
  // Each family shows once, in its most urgent section.
  expect(titles(buildSections(items, now, { ...all, mode: "nested" }))).toEqual({
    firm,
    closing: ["(Renew passport)", "~Fill out form DS-82", "Get passport photos", "~Mail the application"],
    available: ["(Plan birthday dinner)", "Pick a restaurant", "Send invites", "(File tax return)", "Gather W-2s", "~File the return", "Water the plants"],
  });
});

test("subtasks with due dates come first, soonest first; the rest keep their manual order", () => {
  const items: Item[] = [task("parent"),
    task("plain", { parentId: "parent", sortOrder: 0 }),
    task("later", { parentId: "parent", sortOrder: 1, deadline: local(12, 9) }),
    task("sooner", { parentId: "parent", sortOrder: 2, deadline: local(10, 9) }),
    task("also-plain", { parentId: "parent", sortOrder: 3 }),
  ];
  for (const mode of ["nested", "context"] as const) {
    expect(shape(buildSections(items, now, { ...all, mode }))).toEqual({ available: [["(parent)", ["sooner", "later", "plain", "also-plain"]]] });
  }
});

test("Boards: a task stays on its board whatever its urgency; subtasks follow their parent's board unless they have one", () => {
  const board = (id: string): Item => ({ id, kind: "group", title: id, parentId: null, createdAt: at, updatedAt: at });
  const items: Item[] = [board("support"), board("notes"),
    task("call", { groupId: "support", deadline: local(6, 20) }),
    task("idea", { groupId: "notes" }), task("step", { parentId: "idea" }), task("own", { parentId: "idea", groupId: "support" }),
    task("loose", { deadline: local(6, 20) }),
    task("done", { groupId: "notes", state: "completed", completedAt: at }),
  ];
  const byId = new Map(items.map(item => [item.id, item]));
  const boards = buildSections(items, now, { ...all, showCompleted: true, mode: "context", boardOf: entry => taskGroupId(entry, byId) });
  expect(shape(boards)).toEqual({ firm: ["loose"], support: ["call", ["(idea)", ["own"]]], notes: [["(idea)", ["step"]]], completed: ["done"] });
  // Pulling timed tasks off boards: the due call joins Firm; the rest stay on their boards.
  const pulled = buildSections(items, now, { ...all, showCompleted: true, mode: "context", boardOf: (entry, placement) => placement.section === "available" ? taskGroupId(entry, byId) : null });
  expect(shape(pulled)).toEqual({ firm: ["call", "loose"], support: [["(idea)", ["own"]]], notes: [["(idea)", ["step"]]], completed: ["done"] });
  // Agenda: everything by urgency.
  expect(shape(buildSections(items, now, { ...all, mode: "context" })).firm).toEqual(["call", "loose"]);
});

test("unstarted dependent tasks wait under the task they depend on, their own dependents under them", () => {
  const items: Item[] = [task("owner"), task("next", { dependentOf: "owner", startWhen: { on: "parent-done" } }), task("after", { dependentOf: "next" }), task("started", { dependentOf: null })];
  const [section] = buildSections(items, now, { ...all, mode: "context" });
  expect(section.trees.map(node => node.task.id)).toEqual(["owner", "started"]);
  const owner = section.trees[0];
  expect(owner.dependents!.map(node => [node.task.id, node.dependent, node.dependents?.map(child => child.task.id)])).toEqual([["next", true, ["after"]]]);
});
