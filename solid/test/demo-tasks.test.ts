import { expect, test } from "bun:test";
import { demoTasks, hasDemoTasks } from "../src/demo-tasks";
import { planTodos } from "../src/todo-planning";
import { sleepValidationMessage } from "../../site/domain.js";

test("demo examples populate every section even on weekends or near midnight", () => {
  for (const now of [new Date(2026,8,27,0),new Date(2026,8,27,14),new Date(2026,8,28,23,59)]) {
    const items=demoTasks(now), rows=planTodos(items,now);
    expect(new Set(rows.map(row=>row.section)).size).toBe(5);
    expect(rows.filter(row=>row.section==='open')).toHaveLength(2);
    expect(rows.some(row=>row.task.id==='todo-demo:escalate')).toBe(false);
    expect(rows.some(row=>row.task.id==='todo-demo:done')).toBe(false);
    expect(new Set(items.map(item=>item.id)).size).toBe(items.length);
    const ids=new Set(items.map(item=>item.id));
    for(const item of items) if(item.kind==='task') {
      expect(sleepValidationMessage(item,now)).toBe('');
      for(const id of [item.parentId,item.groupId,item.dependentOf].filter(Boolean))expect(ids.has(id!)).toBe(true);
    }
    expect(hasDemoTasks(items)).toBe(true);
  }
});
