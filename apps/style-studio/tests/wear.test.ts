import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject } from '../src/demo.ts';
import { addWear, updateWear, deleteWear, deletePiece, rateLook, updateLook, validateProject, parseProject, serializeProject } from '../src/domain.ts';
import { LIMITS } from '../src/types.ts';
const input = {date:'2026-10-11',occasion:'Gallery opening',notes:'Comfortable through the evening'};
test('wear records retain complete snapshots and explicit feedback without inferred votes',()=>{
 const before=createDemoProject(),id=before.looks[0].id,original=structuredClone(before);
 const added=addWear(before,id,input);assert.deepEqual(before,original);assert.deepEqual(added.examples,before.examples);assert.deepEqual(added.looks[0].pieces,before.looks[0].pieces);
 const record=added.looks[0].wears![0];assert.deepEqual({...record,id:''},{...input,id:''});
 const edited=updateWear(added,id,record.id,{...input,date:'2024-02-29',notes:'  Corrected\nnotes  '});assert.equal(edited.looks[0].wears![0].id,record.id);assert.equal(edited.looks[0].wears![0].notes,'  Corrected\nnotes  ');assert.deepEqual(added.looks[0].wears![0],record);
 const renamed=updateLook(edited,id,{name:'Revisited'});assert.deepEqual(renamed.looks[0].wears,edited.looks[0].wears);
 const removedPiece=deletePiece(renamed,before.pieces[0].id);assert.deepEqual(removedPiece.looks,renamed.looks);
 const liked=rateLook(removedPiece,id,'like'),passed=rateLook(liked,id,'pass');assert.equal(passed.examples.length,liked.examples.length);assert.equal(passed.examples.at(-1)!.id,liked.examples.at(-1)!.id);assert.deepEqual(passed.looks,removedPiece.looks);
 assert.deepEqual(parseProject(serializeProject(passed)),passed);const deleted=deleteWear(added,id,record.id);assert.deepEqual(deleted,before);assert.throws(()=>deleteWear(before,id,record.id),/wear/i);assert.throws(()=>addWear(before,'0'.repeat(32),input),/look/i);
});
test('optional diary preserves legacy profiles and validates real calendar dates and ordinary fields',()=>{
 const before=createDemoProject();assert.deepEqual(parseProject(serializeProject(before)),before);assert.equal(Object.hasOwn(validateProject(before).looks[0],'wears'),false);
 for(const date of ['2000-02-29','0001-01-01','9999-12-31'])assert.equal(addWear(before,before.looks[0].id,{...input,date}).looks[0].wears![0].date,date);
 for(const date of ['1900-02-29','2025-02-29','2026-04-31','2026-13-01','0000-01-01','2026-10-11\n','26-1-1'])assert.throws(()=>addWear(before,before.looks[0].id,{...input,date}),/date/i);
 for(const bad of [{...input,occasion:'x'.repeat(81)},{...input,notes:'x'.repeat(501)},{...input,notes:'\ud800'},{...input,extra:1}])assert.throws(()=>addWear(before,before.looks[0].id,bad));
 const p=addWear(before,before.looks[0].id,input);const sparse=structuredClone(p);delete sparse.looks[0].wears![0];assert.throws(()=>validateProject(sparse));
 const alias=structuredClone(p);alias.looks[0].wears![0].id=alias.looks[0].id;assert.throws(()=>validateProject(alias),/unique/i);
 const duplicate=structuredClone(p);duplicate.looks[0].wears!.push(duplicate.looks[0].wears![0]);assert.throws(()=>validateProject(duplicate),/unique/i);
 const accessor=structuredClone(p);Object.defineProperty(accessor.looks[0].wears![0],'notes',{get:()=>{throw Error('must not run');},enumerable:true});assert.throws(()=>validateProject(accessor),/ordinary/i);
});
test('per-look and complete-profile diary limits fail atomically and remain editable at capacity',()=>{
 const before=createDemoProject(),look=before.looks[0];let p=before;
 for(let i=0;i<LIMITS.wearsPerLook;i++)p=addWear(p,look.id,input);
 const captured=serializeProject(p);assert.throws(()=>addWear(p,look.id,input),/at most/i);assert.equal(serializeProject(p),captured);assert.equal(updateWear(p,look.id,p.looks[0].wears![0].id,{...input,notes:'At capacity'}).looks[0].wears![0].notes,'At capacity');
 const full=structuredClone(p);for(let i=1;i<5;i++){const copy=structuredClone(full.looks[0]);copy.id=(100+i).toString(16).padStart(32,'0');copy.wears=copy.wears!.map((w,j)=>({...w,id:(1000+i*100+j).toString(16).padStart(32,'0')}));full.looks.push(copy);}
 assert.equal(full.looks.flatMap(x=>x.wears??[]).length,LIMITS.wears);assert.deepEqual(parseProject(serializeProject(full)),full);
 const empty=structuredClone(look);empty.id='e'.repeat(32);full.looks.push(empty);const unchanged=structuredClone(full);assert.throws(()=>addWear(full,empty.id,input),/100|wear/i);assert.deepEqual(full,unchanged);
});
