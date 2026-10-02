import test from 'node:test';
import assert from 'node:assert/strict';
import { taskDescendants, taskAncestors, validateTaskParent } from '../site/task-tree.js';
const task = (id, parentId = null) => ({ id, parentId, kind: 'task', title: id, state: 'open' });
test('task trees support deep nesting', () => {
  const items = Array.from({length: 150}, (_, i) => task(String(i), i ? String(i - 1) : null));
  assert.equal(taskDescendants(items, '0').length, 149);
  assert.equal(taskAncestors(items, '149').length, 149);
  assert.throws(() => validateTaskParent(items, '0', '149'), /own ancestor/);
});
test('traversal terminates on concurrent move cycles and orphans', () => {
  const items = [task('a', 'b'), task('b', 'a'), task('c', 'deleted')];
  assert.deepEqual(taskDescendants(items, 'a').map(task => task.id), ['b']);
  assert.throws(() => validateTaskParent([task('a'), {id: 'event', kind: 'event'}], 'a', 'event'), /Only tasks/);
});

test('dependent tasks belong to a task without loops, and deleting a task reaches them', async () => {
  const { validateDependentOf, dependentTasks } = await import('../site/task-tree.js');
  const items = [task('a'), { ...task('b'), dependentOf: 'a' }, { ...task('c'), dependentOf: 'b' }, task('d', 'b'), { id: 'g', kind: 'group', title: 'g' }];
  assert.deepEqual(dependentTasks(items, 'a').map(item => item.id).sort(), ['b', 'c', 'd']);
  assert.throws(() => validateDependentOf(items, 'a', 'c'), /cannot depend on itself/);
  assert.throws(() => validateDependentOf(items, 'a', 'a'), /cannot depend on itself/);
  assert.throws(() => validateDependentOf(items, 'a', 'g'), /only belong to tasks/);
  assert.doesNotThrow(() => validateDependentOf(items, 'd', 'deleted-task'));
});
