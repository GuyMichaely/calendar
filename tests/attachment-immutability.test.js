import * as A from '@automerge/automerge';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createCalendarDocument, addAttachmentMetadata, removeAttachmentMetadata, forkCalendarDocument, mergeCalendarDocuments, materializeItem} from '../sync/automerge-document.js';
const entry = {id:'file', name:'original.txt', type:'text/plain', size:12};
const base = () => createCalendarDocument([{id:'task',kind:'task',title:'Task',state:'open',attachments:[entry]}]);
test('attachment add is idempotent but cannot edit an existing entry', () => {
  const doc=base();
  assert.equal(addAttachmentMetadata(doc,'task',{...entry}),doc);
  assert.throws(() => addAttachmentMetadata(doc,'task',{...entry,name:'renamed.txt'}),/immutable/);
  assert.deepEqual(materializeItem(doc,'task').attachments,[entry]);
});
test('remove/add creates a new whole entry and converges with a concurrent removal', () => {
  const doc=base();
  const oldId=A.getObjectId(doc.items.task.attachments[0]);
  const removed=removeAttachmentMetadata(forkCalendarDocument(doc),'task','file');
  const replacement={...entry,name:'renamed.txt'};
  const renamed=addAttachmentMetadata(removeAttachmentMetadata(forkCalendarDocument(doc),'task','file'),'task',replacement);
  assert.notEqual(A.getObjectId(renamed.items.task.attachments[0]),oldId);
  assert.deepEqual(materializeItem(mergeCalendarDocuments(renamed,removed),'task').attachments,[replacement]);
  assert.deepEqual(materializeItem(mergeCalendarDocuments(removed,renamed),'task').attachments,[replacement]);
});
