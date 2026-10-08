import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readReply, validateRoomReply, validateRoomExport, UnconfirmedReplyError} from '../src/reply-admission.ts';
const id='a'.repeat(32),track='b'.repeat(32);
function room(){return {id,title:'café 🌓',createdAt:1,serverTime:2,myRole:'host',profiles:{host:{name:'Alex'},guest:null},tracks:[{id:track,title:'Song',artist:'',duration:12,uploadedBy:'host',createdAt:1}],ratings:{[track]:{host:0,guest:0}},playlist:[track],playlistRevision:0,playback:{trackId:track,position:0,playing:false,revision:0},memories:[],blend:[],savedMixes:[],savedMixesRevision:0};}
test('admits a complete service snapshot and Python-valid Unicode without changing it',()=>{const r=room();r.title='\ufeff';const before=structuredClone(r);validateRoomReply(r,id,'host');assert.deepEqual(r,before);});
test('refuses malformed snapshots before publication',()=>{
 const cases:unknown[]=[null,{},[],{...room(),id:'c'.repeat(32)},{...room(),myRole:'guest'}, {...room(),ratings:{}},{...room(),playlist:['c'.repeat(32)]},{...room(),tracks:[{...room().tracks[0],duration:NaN}]},{...room(),playback:{...room().playback,position:13}},{...room(),savedMixesRevision:-1},{...room(),memories:[{id:'d'.repeat(32),trackId:track,trackTitle:'Song',text:'Literal',author:'host',date:'2026-02-30',createdAt:2}]}];
 for(const r of cases)assert.throws(()=>validateRoomReply(r,id,'host'),UnconfirmedReplyError);
});
test('admits saved memories after their song has been deleted',()=>{const r={...room(),memories:[{id:'d'.repeat(32),trackId:'e'.repeat(32),trackTitle:'Deleted song',text:'Literal <memory> café 🌓',author:'host',date:'2026-10-08',createdAt:2}]};validateRoomReply(r,id);});
test('export admission requires complete version two notes and refuses credential fields',()=>{const {myRole: _role,serverTime:_time,...r}=room();void _role;void _time;const value={schemaVersion:2,...r};validateRoomExport(value,id);for(const invalid of [{},{...value,schemaVersion:1},{...value,token:'private'},{...value,profiles:{...value.profiles,host:{name:'Alex',token:'private'}}},{...value,id:'c'.repeat(32)}])assert.throws(()=>validateRoomExport(invalid,id),UnconfirmedReplyError);});
test('an interrupted successful HTTP body remains an uncertain operation',async()=>{
 const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','Content-Length':'100'});response.write('{"id":');setTimeout(()=>response.destroy(),100);});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const address=server.address();assert.ok(address&&typeof address!=='string');const response=await fetch(`http://127.0.0.1:${address.port}`);await assert.rejects(readReply(response),UnconfirmedReplyError);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
