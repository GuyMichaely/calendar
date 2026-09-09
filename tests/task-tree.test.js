import test from 'node:test';
import assert from 'node:assert/strict';
import { taskDescendants, taskAncestors, nestTaskRows, validateTaskParent, taskMoveUpdates } from '../site/task-tree.js';
const task = (id, parentId = null) => ({ id, parentId, kind: 'task', title: id, state: 'open' });
test('task trees support deep nesting and filtered parents without losing children', () => {
  const items = Array.from({length: 150}, (_, i) => task(String(i), i ? String(i - 1) : null));
  assert.equal(taskDescendants(items, '0').length, 149);
  assert.equal(taskAncestors(items, '149').length, 149);
  assert.equal(nestTaskRows(items.map(task => ({task})), items).at(-1).depth, 149);
  assert.deepEqual(nestTaskRows([items[0], items[149]].map(task => ({task})), items).map(row => row.depth), [0, 1]);
  assert.equal(nestTaskRows(items.map(task => ({task})), items, new Set(['0'])).length, 1);
  assert.throws(() => validateTaskParent(items, '0', '149'), /own ancestor/);
});
test('orphans and concurrent move cycles remain visible and traversal terminates', () => {
  const items = [task('a', 'b'), task('b', 'a'), task('c', 'deleted')];
  assert.equal(nestTaskRows(items.map(task => ({task})), items).length, 3);
  assert.deepEqual(taskDescendants(items, 'a').map(task => task.id), ['b']);
  assert.throws(() => validateTaskParent([task('a'), {id: 'event', kind: 'event'}], 'a', 'event'), /Only tasks/);
});

test('drag moves order siblings, allow nesting and promotion, and reject descendant cycles', () => {
  const items = [task('a'), task('b'), task('c'), task('child', 'a')];
  assert.deepEqual(taskMoveUpdates(items, 'c', 'a', 'before').map(t => t.id), ['c', 'a', 'b']);
  assert.equal(taskMoveUpdates(items, 'b', 'a', 'inside').find(t => t.id === 'b').parentId, 'a');
  assert.equal(taskMoveUpdates(items, 'child', null, 'root').find(t => t.id === 'child').parentId, null);
  assert.throws(() => taskMoveUpdates(items, 'a', 'child', 'inside'), /own ancestor/);
  const rows = nestTaskRows(items.map(task => ({task})), items, new Set(['a']), true);
  assert.equal(rows.find(row => row.task.id === 'child').hidden, true);
  assert.equal(rows.length, items.length);
});
