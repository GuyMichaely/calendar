import {test, expect} from "bun:test";
import {planTasks, taskVisible} from "../src/task-planning";
import {nestTaskRows} from "../../site/task-tree.js";
import {sleepValidationMessage} from "../../site/domain.js";
import type {Task} from "../src/types";
const now = new Date("2026-09-24T10:00:00Z");
const date = (day: number) => new Date(`2026-09-${day}T12:00:00Z`).toISOString();
const task = (id: string, patch: Partial<Task> = {}): Task => ({id, kind:"task", state:"open", title:id, createdAt:now.toISOString(), updatedAt:now.toISOString(), ...patch});
const ids = (rows: {task: Task}[]) => rows.map(row => row.task.id);
const sleep = (until: string | null) => ({until, startedAt:now.toISOString()});

test("sleepers interleave by effective can-start date and due breaks ties", () => {
 const tasks = [task("awake", {availableFrom:date(26)}), task("sleeper", {availableFrom:date(24), sleep:sleep(date(25)), deadline:date(28)}), task("same-date-earlier-due", {availableFrom:date(25), deadline:date(27)})];
 expect(ids(planTasks(tasks, now, true, "start", null).upcoming)).toEqual(["same-date-earlier-due", "sleeper", "awake"]);
 expect(ids(planTasks(tasks, now, false, "start", null).upcoming)).toEqual(["sleeper", "same-date-earlier-due", "awake"]);
});
test("ignoring sleep restores actionable tasks, including indefinite sleepers", () => {
 const tasks=[task("awake"),task("timed",{sleep:sleep(date(26))}),task("indefinite",{sleep:sleep(null)})];
 const respected=planTasks(tasks,now,true,"start",null);
 expect(ids(respected.now)).toEqual(["awake"]);
 expect(ids(respected.upcoming)).toEqual(["timed","indefinite"]);
 expect(planTasks(tasks,now,false,"start",null).now).toHaveLength(3);
 expect(planTasks(tasks,now,false,"start",null).upcoming).toHaveLength(0);
});
test("horizon applies to effective wake dates, indefinite sleep stays at end", () => {
 const tasks=[task("far",{sleep:sleep(date(29))}),task("indefinite",{sleep:sleep(null)}),task("near",{sleep:sleep(date(25))})];
 expect(ids(planTasks(tasks,now,true,"start",new Date(date(26))).upcoming)).toEqual(["near","indefinite"]);
});
test("due dates control ordering without making available tasks wait", () => {
 const tasks=[task("early-start",{availableFrom:date(25),deadline:date(29)}),task("late-start",{availableFrom:date(26),deadline:date(27)})];
 expect(ids(planTasks(tasks,now,true,"start",null).upcoming)).toEqual(["early-start","late-start"]);
 expect(ids(planTasks(tasks,now,true,"later",null).upcoming)).toEqual(["late-start","early-start"]);
 expect(planTasks([task("ready",{deadline:date(29)})],now,true,"later",null).now).toHaveLength(1);
});
test("sleep max applies in later-date mode; expired sleep has no effect", () => {
 const tasks=[task("wake-later",{availableFrom:date(25),deadline:date(26),sleep:sleep(date(28))}),task("due-later",{availableFrom:date(25),deadline:date(27)})];
 expect(ids(planTasks(tasks,now,true,"later",null).upcoming)).toEqual(["due-later","wake-later"]);
 expect(ids(planTasks(tasks,now,false,"later",null).upcoming)).toEqual(["wake-later","due-later"]);
 expect(planTasks([task("expired",{sleep:sleep(date(23))})],now,true,"start",null).now).toHaveLength(1);
});
test("hidden sleepers disappear independently of respect mode, completed tasks remain", () => {
 const tasks=[task("awake"),task("hidden",{sleep:sleep(null)}),task("completed",{state:"completed",sleep:sleep(null)})];
 for (const respect of [true,false]) {
  const visible=tasks.filter(item=>taskVisible(item,now,true));
  const plan=planTasks(visible,now,respect,"start",null);
  expect(ids(plan.now)).toEqual(["awake"]);
  expect(ids(plan.completed)).toEqual(["completed"]);
 }
});
test("manual order cannot override date sorting through the nested tree", () => {
 const tasks=[task("early",{availableFrom:date(25),sortOrder:4}),task("late",{availableFrom:date(27),sortOrder:0}),task("child",{parentId:"early",availableFrom:date(28)})];
 const rows=planTasks(tasks,now,true,"start",null).upcoming;
 expect(ids(nestTaskRows(rows,tasks,new Set(),true,false))).toEqual(["early","child","late"]);
 expect(ids(planTasks(tasks,now,true,"manual",null).upcoming)).toEqual(["late","early","child"]);
});
test("sleep still respects recurring working hours", () => {
 const item=task("office",{sleep:sleep("2026-09-25T20:00:00Z"),availabilitySchedule:{enabled:true,days:[1,2,3,4,5],start:"08:00",end:"17:00"}});
 const rows=planTasks([item],now,true,"start",null).upcoming;
 expect(rows[0].upcomingAt!.getTime()).toBeGreaterThanOrEqual(new Date(item.sleep!.until!).getTime());
});
test("sleep validation allows equality, rejects later and indefinite deadlines", () => {
 expect(sleepValidationMessage(task("equal",{deadline:date(26),sleep:sleep(date(26))}),now)).toBe("");
 expect(sleepValidationMessage(task("late",{deadline:date(26),sleep:sleep(date(27))}),now)).toMatch(/due date/);
 expect(sleepValidationMessage(task("forever",{deadline:date(26),sleep:sleep(null)}),now)).toMatch(/indefinitely/);
 expect(sleepValidationMessage(task("undated",{sleep:sleep(null)}),now)).toBe("");
 expect(sleepValidationMessage(task("expired",{deadline:date(22),sleep:sleep(date(23))}),now)).toBe("");
});


test("creation date precedes title when scheduling dates tie", () => {
 const older=task("older",{title:"Zebra",createdAt:date(20),availableFrom:date(25),deadline:date(27)});
 const newer=task("newer",{title:"Apple",createdAt:date(21),availableFrom:date(25),deadline:date(27)});
 for(const sort of ["start","later","manual"] as const) expect(ids(planTasks([newer,older],now,true,sort,null).upcoming)).toEqual(["older","newer"]);
 const alphabetic=task("same-age",{...newer,title:"Aardvark",id:"same-age"});
 expect(ids(planTasks([newer,alphabetic],now,true,"start",null).upcoming)).toEqual(["same-age","newer"]);
 const dueFirst={...newer,deadline:date(26)};
 expect(ids(planTasks([older,dueFirst],now,true,"start",null).upcoming)).toEqual(["newer","older"]);
});

test("unified Tasks retains every nonactionable task when the horizon is off", () => {
 const tasks=[task("ready"),task("future",{availableFrom:date(29)}),task("missed-window",{latestStart:date(23)}),task("no-workdays",{availabilitySchedule:{enabled:true,days:[],start:"08:00",end:"17:00"}}),task("sleeper",{sleep:sleep(null)})];
 const sections=planTasks(tasks,now,true,"start",null);
 expect(ids(sections.now)).toEqual(["ready"]);
 expect(ids(sections.upcoming).sort()).toEqual(["future","missed-window","no-workdays","sleeper"]);
 const limited=planTasks(tasks,now,true,"start",new Date(date(26)));
 expect(ids(limited.upcoming).sort()).toEqual(["missed-window","no-workdays","sleeper"]);
});
