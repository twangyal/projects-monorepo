import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
for(const [name,bytes,sha] of [
 ['mediabunny.min.mjs',690410,'652fbe9226e55cb0c0784aaba6b4b73fea4fc0df498f62050cdc617a4bd97ca2'],
 ['LICENSE',16726,'3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04'],
 ['source.tar.gz',580632,'d5f4d61689397557789792c8be7417ce57102a17078cef40aa4bcc7f15e81a5e'],
])test(`unchanged pinned Mediabunny ${name} retains its independently recorded bytes`,async()=>{
 const data=await readFile(new URL(`../vendor/mediabunny/${name}`,import.meta.url));
 assert.equal(data.length,bytes);assert.equal(createHash('sha256').update(data).digest('hex'),sha);
});
