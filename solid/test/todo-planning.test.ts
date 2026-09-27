import { expect, test } from "bun:test";
import { planTodos, priorityOrder } from "../src/todo-planning";
import type { Task } from "../src/types";
const now = new Date(2026, 8, 28, 14); // Monday, local wall-clock time
const iso = (day: number, hour = 0) => new Date(2026, 8, day, hour).toISOString();
const task = (id: string, patch: Partial<Task> = {}): Task => ({ id, kind: "task", state: "open", title: id, createdAt: iso(1), updatedAt: iso(1), ...patch });
const hours = (start: string, end: string) => ({ enabled: true, days: [1,2,3,4,5], start, end });

test("each task belongs to one section; deadline precedence retains closed tasks", () => {
  const rows = planTodos([
    task("due", { deadline: iso(28, 23), availabilitySchedule: hours("16:00", "17:00") }),
    task("overdue", { deadline: iso(27) }),
    task("open", { availabilitySchedule: hours("09:00", "17:00") }),
    task("today", { availableFrom: iso(28, 9) }),
    task("later", { availableFrom: iso(28, 18) }),
    task("research", { availableFrom: iso(20) }),
    task("future", { availableFrom: iso(30) }),
    task("done", { state: "completed" }),
    task("dormant", { dependentOf: "research" }),
  ], now);
  expect(Object.fromEntries(rows.map(row => [row.task.id, row.section]))).toEqual({due:"attention",overdue:"attention",open:"open",today:"today",later:"upcoming",research:"anytime",future:"upcoming"});
  expect(rows.find(row => row.task.id === "due")?.reason).toContain("Available today");
  expect(rows.find(row => row.task.id === "later")?.relevantToday).toBe(true);
  expect(rows.find(row => row.task.id === "overdue")?.due).toContain("Overdue");
});

test("windows close into Upcoming and reopen; closing time wins over interleaved priorities", () => {
  const tasks = [task("late", {sortOrder:0, availabilitySchedule:hours("09:00","17:00")}),task("research",{sortOrder:1}),task("early",{sortOrder:9, availabilitySchedule:hours("09:00","16:00")}),task("tie",{sortOrder:8,availabilitySchedule:hours("09:00","16:00")})];
  expect(planTodos(tasks, now).filter(row=>row.section==="open").map(row=>row.task.id)).toEqual(["tie","early","late"]);
  const evening = planTodos(tasks, new Date(2026,8,28,19));
  expect(evening.filter(row=>row.section==="upcoming")).toHaveLength(3);
  expect(evening.find(row=>row.task.id==="late")?.next?.getTime()).toBe(new Date(2026,8,29,9).getTime());
  expect(planTodos(tasks,new Date(2026,8,29,10)).filter(row=>row.section==="open")).toHaveLength(3);
});

test("future windows today are marked relevant; ongoing tasks are Anytime", () => {
  const rows=planTodos([task("phone",{availabilitySchedule:hours("16:00","17:00")}),task("research")],now);
  expect(rows.find(row=>row.task.id==="phone")).toMatchObject({section:"upcoming",relevantToday:true});
  expect(rows.find(row=>row.task.id==="research")).toMatchObject({section:"anytime",relevantToday:false});
});

test("sleep respects the visibility preference, while due dates still demand attention", () => {
  const tasks=[task("sleep",{sleep:{until:iso(29,12),startedAt:iso(27)}}),task("due",{deadline:iso(28,23),sleep:{until:iso(28,18),startedAt:iso(27)}}),task("indefinite",{sleep:{until:null,startedAt:iso(27)}})];
  expect(planTodos(tasks,now).map(row=>[row.task.id,row.section])).toEqual([["due","attention"],["sleep","upcoming"],["indefinite","upcoming"]]);
  expect(planTodos(tasks,now,false).find(row=>row.task.id==="sleep")?.section).toBe("anytime");
  expect(planTodos(tasks,now,true,true)).toEqual([]);
  expect(planTodos(tasks,now,false,true)).toEqual([]);
});

test("changing date only reprojects tasks, without rewriting them or their priority", () => {
  const tasks=[task("start",{availableFrom:iso(28),sortOrder:7})];const snapshot=JSON.stringify(tasks);
  expect(planTodos(tasks,now)[0].section).toBe("today");
  expect(planTodos(tasks,new Date(2026,8,29,10))[0].section).toBe("anytime");
  expect(JSON.stringify(tasks)).toBe(snapshot);
});

test("priority moves preserve group and parent membership", () => {
  const tasks=[task("a",{groupId:"work",sortOrder:0}),task("b",{groupId:"home",sortOrder:1}),task("c",{parentId:"a",sortOrder:2})];
  const order=priorityOrder(tasks,"c","a",true);
  expect(order.map(entry=>entry.task.id)).toEqual(["c","a","b"]);
  expect(order[0].task.parentId).toBe("a");expect(order[2].task.groupId).toBe("home");
  expect(tasks.map(task=>task.sortOrder)).toEqual([0,1,2]);
});
