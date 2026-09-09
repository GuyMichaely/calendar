import { SYNC_RESET_HEADER, AUTOMERGE_RESET_MEDIA_TYPE } from "../sync/protocol.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import {createCalendarDocument,saveCalendarDocument,loadCalendarDocument,mergeCalendarDocuments,patchItem} from '../sync/automerge-document.js';
import {createCalendarSyncClient,CalendarSyncError} from '../sync/client.js';
import {createSyncHandler,createMemoryDocumentStore} from '../backend/sync/http.js';
const server=store=>createSyncHandler({authenticate:async()=>({identity:{issuer:'issuer',subject:'owner'}}),documentStore:store});
function replica(fetch,items=[]){let doc=createCalendarDocument(items);const client=createCalendarSyncClient({readSnapshot:async()=>saveCalendarDocument(doc),mergeSnapshot:async bytes=>{doc=mergeCalendarDocuments(doc,loadCalendarDocument(bytes));}},{endpoint:'https://sync.example/sync',fetch});return{sync:()=>client.sync(),edit:(id,p)=>{doc=patchItem(doc,id,p);},get doc(){return doc;}};}
const task={id:'a',kind:'task',title:'Task',state:'open'};
test('native sync is incremental, includes credentials and survives server restart',async()=>{
 const store=createMemoryDocumentStore();let handler=server(store),bytes=0;
 const peer=replica(async(url,init)=>{assert.equal(init.credentials,'include');bytes+=init.body.byteLength;const r=await handler(new Request(url,init));assert.equal(r.status,200);bytes+=(await r.clone().arrayBuffer()).byteLength;return r;},Array.from({length:100},(_,i)=>({...task,id:String(i)})));
 await peer.sync();bytes=0;await peer.sync();assert.equal(bytes,0);
 peer.edit('0',{title:'Changed'});await peer.sync();assert.ok(bytes<saveCalendarDocument(peer.doc).length,'small edit sends less than a snapshot');
 handler=server(store);await peer.sync();assert.equal(loadCalendarDocument(await store.get('calendar:primary')).items['0'].title,'Changed');
});
test('a lost response resets peer state and converges on retry',async()=>{
 const store=createMemoryDocumentStore(),handler=server(store);let drop=true;
 const peer=replica(async(url,init)=>{const response=await handler(new Request(url,init));if(drop && loadCalendarDocument(await store.get('calendar:primary')).items.a){drop=false;throw new Error('connection lost');}return response;},[task]);
 await assert.rejects(peer.sync(),/connection lost/);await peer.sync();assert.equal(loadCalendarDocument(await store.get('calendar:primary')).items.a.title,'Task');
});
test('edits during an exchange and overlapping sync calls converge',async()=>{
 const store=createMemoryDocumentStore(),handler=server(store);let edited=false;
 const peer=replica(async(url,init)=>{const response=await handler(new Request(url,init));if(!edited){edited=true;peer.edit('a',{notes:'edited in flight'});}return response;},[task]);
 await Promise.all([peer.sync(),peer.sync()]);assert.equal(loadCalendarDocument(await store.get('calendar:primary')).items.a.notes,'edited in flight');
});
test('HTTP auth and invalid response types are surfaced',async()=>{
 await assert.rejects(replica(async()=>new Response('Unauthorized',{status:401}),[task]).sync(),error=>error instanceof CalendarSyncError&&error.status===401);
 await assert.rejects(replica(async()=>new Response('wrong',{headers:{'content-type':'text/plain'}}),[task]).sync(),/Invalid sync response/);
});

test('repeated session resets stop after one retry',async()=>{
 let attempts=0;
 const peer=replica(async()=>{attempts++;return new Response(null,{headers:{'content-type':AUTOMERGE_RESET_MEDIA_TYPE,[SYNC_RESET_HEADER]:'1'}});},[task]);
 await assert.rejects(peer.sync(),/repeatedly restarted/);
 assert.equal(attempts,2);
});
