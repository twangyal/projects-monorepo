import test from 'node:test';
import assert from 'node:assert/strict';
import { heardAlike, lineList, lineWords, similarLines, repeatedCueLines } from '../src/repeated-lines.ts';

test('a repeat heard differently is found from the corrected line or from the correction itself', () => {
  const heard = ['This is our chorus', 'Sing it back to me', 'This is a chorus', 'Diss is our course tonight', 'Goodbye'];
  // Correcting line 1 offers line 3 (heard like line 1) and line 4 (heard like the correction more than like line 1).
  assert.deepEqual(similarLines(heard, heard, 0, 'This is our chorus tonight'), [2, 3]);
  // A line the person already changed is never offered, nor one that already says the correction.
  assert.deepEqual(similarLines(heard, [heard[0]!, heard[1]!, 'This is our chorus', heard[3]!, heard[4]!], 0, 'This is our chorus tonight'), [3]);
  // Two of four words differing is not a repeat ("this is my song", "this is your life").
  assert.ok(!heardAlike('This is our chorus', 'This is a horus'));
  // No correction (only punctuation or case changed) and short lines offer nothing.
  assert.deepEqual(similarLines(heard, heard, 0, 'this is our chorus!'), []);
  assert.deepEqual(similarLines(['Oh yeah', 'Oh yeah', 'Oh no'], ['Oh yeah', 'Oh yeah', 'Oh no'], 0, 'Oh yes'), []);
  assert.deepEqual(similarLines(heard, heard, 1, 'Sing it back to me now'), []);
});

test('lines compare by words, and unspaced scripts by character', () => {
  assert.deepEqual(lineWords('Don’t stop, believin’!'), ["don't", 'stop', 'believin']);
  assert.deepEqual(lineWords("Don't STOP"), ["don't", 'stop']);
  assert.deepEqual(lineWords('愛してるずっと'), ['愛', 'し', 'て', 'る', 'ず', 'っ', 'と']);
  assert.ok(heardAlike('愛してるずっと', '愛してるきっと'));
  assert.ok(!heardAlike('This is our chorus', 'Something else entirely here'));
});

test('line lists read naturally', () => {
  assert.equal(lineList([2]), 'line 3');
  assert.equal(lineList([4, 8]), 'lines 5 and 9');
  assert.equal(lineList([1, 3, 6]), 'lines 2, 4 and 7');
});


test('current repeats match recognized intervals rather than shifted array indices', () => {
  const heard=['This is our horus','Sing it back to me','This is a chorus','This is our chorus'].map((text,i)=>({start:i*4,end:i*4+2,text}));
  const current=[{start:0,end:2,text:'This is our chorus tonight'},{start:2,end:3,text:'Inserted correction'},...structuredClone(heard.slice(1))];
  const before=structuredClone(current);
  assert.deepEqual(repeatedCueLines(heard,current,0),[3,4]);
  current[3].text='My separately corrected chorus';
  assert.deepEqual(repeatedCueLines(heard,current,0),[4]);
  current[4].start+=.25;
  assert.deepEqual(repeatedCueLines(heard,current,0),[]);
  assert.deepEqual(before.slice(0,3),current.slice(0,3));
  assert.equal(heard[0].text,'This is our horus');
});

test('unrecognized, retimed, split and unchanged source wording produces no current repeat offer', () => {
  const heard=[{start:0,end:2,text:'This is our horus'},{start:4,end:6,text:'This is a chorus'}];
  assert.deepEqual(repeatedCueLines(heard,heard,0),[]);
  assert.deepEqual(repeatedCueLines(heard,[{...heard[0],start:.1,text:'This is our chorus'},heard[1]],0),[]);
  assert.deepEqual(repeatedCueLines(heard,[{...heard[0],end:1,text:'This is our chorus'},heard[1]],0),[]);
  assert.deepEqual(repeatedCueLines(heard,[{start:2,end:3,text:'This is our chorus'},heard[1]],0),[]);
  assert.deepEqual(repeatedCueLines(heard,heard,99),[]);
});
