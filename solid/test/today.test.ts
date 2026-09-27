import { expect, test } from "bun:test";
import { buildSections, placeTask, pushedDownInfo, warnTime, type Section } from "../src/today";
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
  expect(section(task("c", { deadline: local(9, 12), warnAt: local(6, 9) }))).toBe("firm");
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
  // Legacy inline hours still count as a window.
  expect(section(task("e", { availabilitySchedule: { enabled: true, days: [2], start: "08:00", end: "12:00" } }))).toBe("upcoming");
});

test("can-start dates, anytime, and pushed-down tasks", () => {
  expect(section(task("a", { availableFrom: local(6, 16) }))).toBe("later");
  expect(section(task("b", { availableFrom: local(8, 9) }))).toBe("upcoming");
  expect(section(task("c", { anytime: true }))).toBe("anytime");
  expect(section(task("d"))).toBe("available");
  expect(pushedDownInfo(task("e", { pushedDown: { until: null, at } }), now).pushed).toBe(true);
  expect(pushedDownInfo(task("f", { pushedDown: { until: local(6, 12), at } }), now).pushed).toBe(false);
  // Legacy sleep reads as pushed down.
  expect(pushedDownInfo(task("g", { sleep: { until: local(9, 0), startedAt: at } }), now).pushed).toBe(true);
});

test("windows describe themselves and find their next opening", () => {
  expect(describeSchedule(business)).toBe("Mon–Fri 09:00–17:00");
  expect(describeSchedule(evening)).toBe("Daily 18:00–22:00");
  expect(describeSchedule(window("x", [1, 3], "10:00", "11:00"))).toBe("Mon, Wed 10:00–11:00");
  // Friday evening: next business opening is Monday.
  expect(nextOpening(business, new Date(2026, 9, 9, 18))?.opens).toEqual(new Date(local(12, 9)));
});

const shape = (sections: Section[]) => Object.fromEntries(sections.map(entry => [entry.id, entry.trees.map(function show(node): unknown {
  const label = node.context ? `(${node.task.id})` : node.task.id;
  return node.children.length ? [label, node.children.map(show)] : label;
})]));

test("subtasks show in their own section with their ancestors as context, or nest under their parent", () => {
  const items: Item[] = [business,
    task("parent", { sortOrder: 0 }),
    task("child-now", { parentId: "parent", sortOrder: 0 }),
    task("child-window", { parentId: "parent", windowId: "business" }),
    task("grand-child", { parentId: "child-window", deadline: local(7, 9) }),
    task("solo", { sortOrder: 1 }),
  ];
  const context = buildSections(items, now, { mode: "context", showCompleted: false, include: () => true });
  expect(shape(context)).toEqual({
    firm: [["(parent)", [["(child-window)", ["grand-child"]]]]],
    closing: [["(parent)", ["child-window"]]],
    available: [["parent", ["child-now"]], "solo"],
  });
  expect(context.find(entry => entry.id === "closing")!.count).toBe(1);
  const nested = buildSections(items, now, { mode: "nested", showCompleted: false, include: () => true });
  expect(shape(nested)).toEqual({ available: [["parent", ["child-now", ["child-window", ["grand-child"]]]], "solo"] });
});

test("a completed parent stays as context for its open subtasks", () => {
  const items: Item[] = [task("done", { state: "completed", completedAt: at }), task("left", { parentId: "done" })];
  expect(shape(buildSections(items, now, { mode: "context", showCompleted: false, include: () => true }))).toEqual({ available: [["(done)", ["left"]]] });
  expect(shape(buildSections(items, now, { mode: "nested", showCompleted: false, include: () => true }))).toEqual({ available: ["left"] });
});

test("the subtask samples differ between the two modes as their notes describe", async () => {
  const { sampleSubtaskItems } = await import("../src/demo-data");
  const items = sampleSubtaskItems(now);
  const titles = (sections: Section[]) => Object.fromEntries(sections.map(entry => [entry.id, entry.trees.map(function flat(node): string[] { return [(node.context ? "(" : "") + node.task.title + (node.context ? ")" : ""), ...node.children.flatMap(flat)]; }).flat()]));
  const own = titles(buildSections(items, now, { mode: "context", showCompleted: false, include: () => true }));
  expect(own.firm).toEqual(["(Apartment move)", "(Sort out utilities)", "Cancel old internet plan", "Pay phone bill"]);
  expect(own.closing).toEqual(["(Renew passport)", "Get passport photos"]);
  expect(own.available).toContain("(File tax return)");
  expect(own.available).toContain("(Learn Spanish)");
  expect(own.upcoming).toEqual(["(Renew passport)", "Mail the application", "File tax return", "(Apartment move)", "Sort out utilities"]);
  const nested = titles(buildSections(items, now, { mode: "nested", showCompleted: false, include: () => true }));
  expect(Object.keys(nested)).toEqual(["firm", "available", "anytime", "upcoming"]);
  expect(nested.firm).toEqual(["Pay phone bill"]);
  expect(nested.upcoming).toEqual(["File tax return", "Gather W-2s"]);
  expect(nested.anytime).toEqual(["Learn Spanish", "Download a language app"]);
});
