import test from 'node:test';import assert from 'node:assert/strict';
import {validateProject,validateSaveReply,readReply,UnconfirmedReplyError} from '../src/project-admission.ts';
const original={schemaVersion:1 as const,id:'a'.repeat(32),title:'Literal café 🌓',duration:6,revision:2,cues:[{start:.25,end:1.125,text:' <kept>\nwords '} ]};
test('valid project admission detaches exact words, numbers and metadata',()=>{const admitted=validateProject(original);assert.deepEqual(admitted,original);assert.notEqual(admitted.cues,original.cues);});
test('Save acknowledgment must match clip, source duration, next revision and every sent edit',()=>{
 const acknowledged={...original,revision:3};assert.deepEqual(validateSaveReply(acknowledged,original),acknowledged);
 for(const bad of [{},{...acknowledged,id:'b'.repeat(32)},{...acknowledged,duration:5},{...acknowledged,revision:2},{...acknowledged,title:'Other words'},{...acknowledged,cues:[]}])assert.throws(()=>validateSaveReply(bad,original),UnconfirmedReplyError);
});
test('malformed project graphs cannot become the working clip',()=>{for(const bad of [null,[],{...original,schemaVersion:2},{...original,revision:NaN},{...original,id:'other'},{...original,cues:[{start:0,end:8,text:'outside'}]},{...original,title:''}])assert.throws(()=>validateProject(bad));});
test('unreadable successful JSON is unconfirmed rather than successful empty data',async()=>{await assert.rejects(readReply(new Response('{"id":',{status:200})),UnconfirmedReplyError);assert.deepEqual(await readReply(new Response('{"error":"refused"}',{status:409})),{error:'refused'});});
test('a real interrupted HTTP response body cannot acknowledge Save',async()=>{
 const {createServer}=await import('node:http');const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','Content-Length':'100'});response.write('{"id":');setTimeout(()=>response.destroy(),100);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address();assert.ok(address&&typeof address==='object');const response=await fetch(`http://127.0.0.1:${address.port}`);await assert.rejects(readReply(response),UnconfirmedReplyError);}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('unreadable success retains the interrupted-response classification used by archive restore protection',async()=>{await assert.rejects(readReply(new Response('{"job":',{status:202})),TypeError);});
