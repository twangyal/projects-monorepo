import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../src/workspace.js';
import {encodeDraftBackup,parseDraftBackup,MAX_BACKUP_BYTES} from '../src/draft-backup.js';
const record=(subject='Original',body='Full text')=>({subject,body});
const file=records=>JSON.stringify({format:'gaze-session-drafts',version:1,drafts:records});
test('backup round trip preserves exact Unicode, whitespace, order and detached saved text',()=>{
 const rows=[record('A 🦊','line\n tabs\t <img onerror=alert(1)>'),record('B','  original trailing  ')];const encoded=encodeDraftBackup(rows);assert.deepEqual(parseDraftBackup(encoded),rows);const parsed=parseDraftBackup(encoded);parsed[0].body='changed';assert.deepEqual(parseDraftBackup(encoded),rows);
});
test('unknown schemas, fields, types and invalid records refuse the whole backup',()=>{
 for(const raw of ['{',file([]),file([record(),{subject:1,body:'x'}]),file([record('x'.repeat(201))]),file([record('valid','x'.repeat(10001))]),file([record(' ','')]),JSON.stringify({format:'gaze-session-drafts',version:2,drafts:[record()]}),JSON.stringify({format:'gaze-session-drafts',version:1,drafts:[record()],camera:'forbidden'}),file([{...record(),id:'draft-1'}])])assert.throws(()=>parseDraftBackup(raw));
});
test('complete twenty-draft escaped maximum fits, but UTF8 bytes and count caps are enforced',()=>{
 const rows=Array.from({length:20},()=>record('x'.repeat(200),'\u0000'.repeat(10000)));assert.deepEqual(parseDraftBackup(encodeDraftBackup(rows)),rows);assert.throws(()=>parseDraftBackup(file([...rows,record()])));assert.throws(()=>parseDraftBackup(' '.repeat(MAX_BACKUP_BYTES+1)));assert.throws(()=>parseDraftBackup('🦊'.repeat(MAX_BACKUP_BYTES/4+1)));assert.throws(()=>encodeDraftBackup(rows.concat(record())));
});
test('append allocates distinct identities and refuses invalid or excess input atomically',()=>{
 const w=createWorkspace();const before=w.saveDraft('Existing','Keep');w.appendDrafts(parseDraftBackup(file([record('Imported','First'),record('Imported','Second')])));assert.deepEqual(w.drafts(),[before,{id:'draft-2',subject:'Imported',body:'First'},{id:'draft-3',subject:'Imported',body:'Second'}]);assert.throws(()=>w.appendDrafts([record('valid'),record('x'.repeat(201))]));assert.equal(w.drafts().length,3);assert.throws(()=>w.appendDrafts(Array.from({length:18},()=>record())));assert.equal(w.drafts().length,3);
});
