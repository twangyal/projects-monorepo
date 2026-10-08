import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import vm from'node:vm';import ts from'typescript';
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const requestSource=source.slice(source.indexOf('async function request<'),source.indexOf('function json('));
test('actual request helper refuses unreadable HTTP success rather than publishing empty data',async()=>{
 const helpers=await import('../src/'+'project-admission.ts').catch(()=>({}));const context=vm.createContext({...helpers,Headers,fetch,session:null});vm.runInContext(ts.transpile(requestSource,{target:ts.ScriptTarget.ES2022}),context);
 const request=context.request as (path:string)=>Promise<unknown>;
 await assert.rejects(request('data:application/json,%7B%22id%22%3A'),/unconfirmed/i);
});
