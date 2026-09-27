import type { Item, Task } from "./types";

const prefix = "todo-demo:";
export const hasDemoTasks = (items: Item[]) => items.some(item => item.id.startsWith(prefix));

/** Real task records with relative dates, so the examples work whenever they are loaded. */
export function demoTasks(now = new Date()): Item[] {
  const at = now.toISOString();
  const date = (offset: number, hours = 0, minutes = 0) => {
    const result = new Date(now); result.setDate(result.getDate() + offset); result.setHours(hours, minutes, 0, 0); return result.toISOString();
  };
  const id = (name: string) => prefix + name;
  const base = { createdAt: at, updatedAt: at };
  const task = (name: string, title: string, patch: Partial<Task> = {}): Task => ({ ...base, id: id(name), kind: "task", state: "open", title, sortOrder: 0, tags: ["demo"], groupId: id("life"), ...patch });
  const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2,"0")}:${String(minutes % 60).padStart(2,"0")}`;
  const minute = now.getHours() * 60 + now.getMinutes();
  const window = (end: number) => ({ enabled: true, days: [0,1,2,3,4,5,6], start: "00:00", end: clock(Math.min(1439, end)) });
  return [
    { ...base, id: id("life"), kind: "group", title: "Demo · Life admin", sortOrder: 0 },
    { ...base, id: id("research"), kind: "group", title: "Demo · Research", sortOrder: 1 },
    task("credit", "Pay credit card", { deadline: date(0,23,59), notes: "Due today, so this stays in Needs Attention. Complete it, then use Undo to bring it back." }),
    task("form", "Submit reimbursement", { deadline: date(-1,23,59), sortOrder: 1, notes: "An overdue task remains in Needs Attention until completed." }),
    task("pharmacy", "Call pharmacy", { availabilitySchedule: window(minute+60), sortOrder: 5, notes: "This sample window is open when loaded. Open Now sorts by closing time before manual priority." }),
    task("insurance", "Call insurance", { availabilitySchedule: window(minute+180), sortOrder: 2, notes: "This window closes later than the pharmacy's (unless both reach midnight). Edit Timing to experiment with working hours." }),
    task("proposal", "Review the proposal", { availableFrom: date(0), notes: "The start date is today. Tomorrow this becomes Anytime if it is still open." }),
    task("future", "Prepare next week’s trip", { availableFrom: date(2,9), notes: "A future start keeps this in Upcoming." }),
    task("sleep", "Follow up on refund", { sleep: { startedAt: at, until: date(1,9) }, notes: "Try Respect sleep and Hide sleeping tasks, or wake this task from its menu." }),
    task("closed", "Call weekend support", { availabilitySchedule: { enabled: true, days: [(now.getDay()+1)%7], start: "09:00", end: "17:00" }, notes: "This sample support window opens tomorrow. Upcoming shows the next available time." }),
    task("crdt", "Explore CRDT approaches", { groupId: id("research"), sortOrder: 1, notes: "Ongoing research belongs in Anytime.\n\n- Compare merge behavior\n- Capture useful examples\n\nDrag this above another Anytime task to change priority without changing its group." }),
    task("goggles", "Buy swim goggles", { sortOrder: 2, notes: "An unrestricted task. Drag it in Anytime or organize it in Groups." }),
    task("packing", "Pack the swimming bag", { sortOrder: 3, notes: "This parent has two subtasks. Completing or deleting it also affects its children; Undo restores the whole change." }),
    task("towel", "Pack a towel", { parentId: id("packing"), groupId: null, sortOrder: 4 }),
    task("water", "Fill the water bottle", { parentId: id("packing"), groupId: null, sortOrder: 5 }),
    task("receipt", "Find the refund receipt", { sortOrder: 6, notes: "Open the editor to see a dormant dependent task. Completing this offers to start that next step." }),
    task("escalate", "Contact support about the refund", { dependentOf: id("receipt"), relativeDates: { availableFrom: 0, deadline: 3 }, notes: "This stays out of Tasks until started. Its due date becomes three days after starting." }),
    task("done", "File last month’s receipts", { state: "completed", completedAt: at, notes: "Enable Show completed to see this example." }),
  ];
}
