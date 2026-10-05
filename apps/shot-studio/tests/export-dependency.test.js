import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
for(const [name,bytes,sha] of [
 ['mediabunny.min.mjs',690410,'652fbe9226e55cb0c0784aaba6b4b73fea4fc0df498f62050cdc617a4bd97ca2'],
 ['LICENSE',16726,'3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04'],
 ['source.tar.gz',576437,'2e5cf590d501cfdd5a8fc41a9a8a95822df39fdf3c4d761e6cc581577145ef67'],
])test(`unchanged pinned Mediabunny ${name} retains its independently recorded bytes`,async()=>{
 const data=await readFile(new URL(`../vendor/mediabunny/${name}`,import.meta.url));
 assert.equal(data.length,bytes);assert.equal(createHash('sha256').update(data).digest('hex'),sha);
});
