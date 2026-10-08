import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import vm from'node:vm';import ts from'typescript';
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const apiSource=source.slice(source.indexOf('async function api<'),source.indexOf('function roomPath('));
async function api(){
 const helpers=await import('../src/'+'reply-admission.ts').catch(()=>({}));
 const context=vm.createContext({...helpers,Headers,fetch,Date,credentials:null,ApiError:class extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status;}}});
 vm.runInContext(ts.transpile(apiSource,{target:ts.ScriptTarget.ES2022}),context);
 return context.api as (path:string)=>Promise<{value:unknown}>;
}
test('actual API function refuses malformed successful JSON instead of returning empty data',async()=>{
 const call=await api();await assert.rejects(call('data:application/json,%7B%22id%22%3A'),/unconfirmed/i);
});
test('actual API function still returns exact valid JSON',async()=>{const call=await api();assert.deepEqual((await call('data:application/json,%7B%22literal%22%3A%22caf%C3%A9%22%7D')).value,{literal:'café'});});
