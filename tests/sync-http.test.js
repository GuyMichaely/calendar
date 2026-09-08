import * as A from '@automerge/automerge';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarDocument, loadCalendarDocument, saveCalendarDocument, mergeCalendarDocuments, materializeItems, patchItem } from '../sync/automerge-document.js';
import { createCalendarSyncClient } from '../sync/client.js';
import { AUTOMERGE_MEDIA_TYPE, SYNC_SESSION_HEADER, SYNC_SEQUENCE_HEADER } from '../sync/protocol.js';
import {createSyncHandler,createMemoryDocumentStore} from '../backend/sync/http.js';
const identity={issuer:'issuer',subject:'owner'};
const auth=async()=>({identity});
const task=id=>({id,kind:'task',title:id,state:'open'});
function request(body=new Uint8Array(),sequence=0,id=crypto.randomUUID(),headers={}) {
 return new Request('https://sync.example/sync',{method:'POST',headers:{'content-type':AUTOMERGE_MEDIA_TYPE,[SYNC_SESSION_HEADER]:id,[SYNC_SEQUENCE_HEADER]:String(sequence),...headers},body});
}
function client(handler,items=[]) {
 let doc=createCalendarDocument(items);
 const transport=createCalendarSyncClient({readSnapshot:async()=>saveCalendarDocument(doc),mergeSnapshot:async bytes=>{doc=mergeCalendarDocuments(doc,loadCalendarDocument(bytes));return doc;}},{endpoint:'https://sync.example/sync',fetch:(url,init)=>handler(new Request(url,init))});
 return {sync:()=>transport.sync(),get doc(){return doc;},edit:(id,patch)=>{doc=patchItem(doc,id,patch);}};
}
test('authentication, content type and malformed messages reject before storage',async()=>{
 let accesses=0;
 const documentStore={async update(){accesses++;throw new Error('must not access');}};
 assert.equal((await createSyncHandler({authenticate:async()=>null,documentStore})(request())).status,401);
 const handler=createSyncHandler({authenticate:auth,documentStore});
 assert.equal((await handler(request(new Uint8Array([1,2,3])))).status,400);
 assert.equal((await handler(request(new Uint8Array(),0,'bad'))).status,400);
 assert.equal((await handler(request(new Uint8Array(),0,crypto.randomUUID(),{'content-type':'application/vnd.automerge'}))).status,415);
 assert.equal(accesses,0);
});
test('fresh devices exchange native messages and preserve simultaneous edits',async()=>{
 const store=createMemoryDocumentStore();const handler=createSyncHandler({authenticate:auth,documentStore:store});
 const left=client(handler,[task('a')]),right=client(handler,[task('b')]);
 await Promise.all([left.sync(),right.sync()]);await left.sync();await right.sync();
 assert.deepEqual(materializeItems(left.doc).map(x=>x.id).sort(),['a','b']);
 left.edit('a',{title:'left'});right.edit('a',{notes:'right'});
 await Promise.all([left.sync(),right.sync()]);await left.sync();await right.sync();
 assert.deepEqual(materializeItems(left.doc).sort((a,b)=>a.id.localeCompare(b.id)),materializeItems(right.doc).sort((a,b)=>a.id.localeCompare(b.id)));
 const saved=loadCalendarDocument(await store.get('calendar:primary'));
 assert.equal(saved.items.a.title,'left');assert.equal(saved.items.a.notes,'right');
});
test('idle polls receive edits from a different peer',async()=>{
 const handler=createSyncHandler({authenticate:auth,documentStore:createMemoryDocumentStore()});
 const first=client(handler,[task('a')]),second=client(handler);
 await first.sync();await second.sync();first.edit('a',{title:'changed remotely'});await first.sync();await second.sync();
 assert.equal(second.doc.items.a.title,'changed remotely');
});
test('expired, replayed and out-of-order sessions request a fresh connection',async()=>{
 let now=0;const handler=createSyncHandler({authenticate:auth,documentStore:createMemoryDocumentStore(),now:()=>now,sessionTtlMs:10});
 const id=crypto.randomUUID();assert.equal((await handler(request(new Uint8Array(),0,id))).status,200);
 assert.equal((await handler(request(new Uint8Array(),0,id))).status,410);
 assert.equal((await handler(request(new Uint8Array(),3,id))).status,410);
 now=11;assert.equal((await handler(request(new Uint8Array(),1,id))).status,410);
});
test('peer state is isolated by authenticated identity',async()=>{
 let who='a';const handler=createSyncHandler({authenticate:async()=>({identity:{issuer:'issuer',subject:who}}),documentStore:createMemoryDocumentStore()});
 const id=crypto.randomUUID();assert.equal((await handler(request(new Uint8Array(),0,id))).status,200);who='b';
 assert.equal((await handler(request(new Uint8Array(),1,id))).status,410);
 assert.equal((await handler(request(new Uint8Array(),0,id))).status,200);
});
test('server read/write failures remain 500 irrespective of wording',async()=>{
 for(const error of [new TypeError('Automerge'),new RangeError('calendar sync schema')]){
  const handler=createSyncHandler({authenticate:auth,documentStore:{async update(){throw error;}}});
  assert.equal((await handler(request())).status,500);
 }
 const store=createMemoryDocumentStore({'calendar:primary':new Uint8Array([1,2,3])});
 assert.equal((await createSyncHandler({authenticate:auth,documentStore:store})(request())).status,500);
 assert.deepEqual(await store.get('calendar:primary'),new Uint8Array([1,2,3]));
});
test('incompatible native document changes cannot mutate stored data',async()=>{
 const bytes=saveCalendarDocument(createCalendarDocument([task('safe')]));const store=createMemoryDocumentStore({'calendar:primary':bytes});
 const handler=createSyncHandler({authenticate:auth,documentStore:store});
 let doc=A.from({schemaVersion:1,items:{bad:task('bad')}}),state=A.initSyncState();const id=crypto.randomUUID();let rejected=false;
 for(let sequence=0;sequence<5;sequence++){
  let message;[state,message]=A.generateSyncMessage(doc,state);if(!message)break;
  const response=await handler(request(message,sequence,id));
  if(response.status===409){rejected=true;break;}
  assert.equal(response.status,200);const reply=new Uint8Array(await response.arrayBuffer());if(reply.length)[doc,state]=A.receiveSyncMessage(doc,state,reply);
 }
 assert.ok(rejected);assert.deepEqual(await store.get('calendar:primary'),bytes);
});
test('routing and methods are explicit',async()=>{
 const handler=createSyncHandler({authenticate:auth,documentStore:createMemoryDocumentStore()});
 assert.equal((await handler(new Request('https://sync.example/sync'))).status,405);
 assert.equal((await handler(new Request('https://sync.example/other'))).status,404);
});
