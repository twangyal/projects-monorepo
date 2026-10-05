import test from 'node:test';
import assert from 'node:assert/strict';
import {saveDownload} from '../scripts/download-diagnostics.mjs';

test('a disconnected download diagnostic preserves the original save failure',async()=>{
 const original=Error('original saveAs failure');
 const file={async saveAs(){throw original;},async failure(){throw Error('diagnostic channel closed');}};
 const page={isClosed:()=>false,context:()=>({browser:()=>({isConnected:()=>true})})};
 await assert.rejects(saveDownload(file,page,'#sequence-save','backup.shot-sequence'),error=>{
  assert.equal(error.cause,original);
  assert.match(error.message,/original saveAs failure/);
  assert.match(error.message,/diagnostic channel closed/);
  assert.equal(error.diagnostics.pageClosed,false);
  assert.equal(error.diagnostics.browserConnected,true);
  return true;
 });
});

test('successful download saving does not ask the browser for failure diagnostics',async()=>{
 let saved;
 await saveDownload({async saveAs(path){saved=path;},async failure(){assert.fail('failure lookup on success');}},null,'#save','complete.json');
 assert.equal(saved,'complete.json');
});
