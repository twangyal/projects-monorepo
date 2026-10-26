import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model.ts';
import { template } from '../src/product.ts';
import { createProjectImageValidator } from '../src/project-media.ts';

const image = (marker = 0) => ({
  dataUrl: 'data:image/jpeg;base64,' + Buffer.from([255,216,255,224,0,4,marker,0,255,192,0,17,8,0,3,0,2,3,1,17,0,2,17,0,3,17,0,255,217]).toString('base64'),
  width:2,height:3,name:'photo.jpg',
});

test('successful content validation is reused across edits while headers and policy remain checked', async () => {
  let decoded = 0, closed = 0;
  const native = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (async () => { decoded++; return {width:2,height:3,close:() => {closed++;}} as ImageBitmap; }) as typeof createImageBitmap;
  try {
    const validate = createProjectImageValidator();
    const project = {...createProject(),photo:image()};
    await validate(project);
    await validate({...project,title:'Changed title',photo:{...project.photo,name:'Renamed.jpg'}});
    assert.equal(decoded,1);
    await assert.rejects(validate({...project,photo:{...project.photo,width:3}}), /dimensions|metadata/i);
    await assert.rejects(validate({...project,photo:{...project.photo,name:''}}), /name/i);
    assert.equal(decoded,1,'cached pixels never bypass header and metadata checks');
    const product = template('blank');
    product.motifs = [{...image(),id:'motif-1'}];
    product.artwork = [{...image(),part:'front',xCm:0,yCm:0,widthCm:10}];
    await validate({...project,product});
    await validate({...project,product});
    assert.equal(decoded,3,'photo, motif and artwork validation policies stay distinct');
    await validate({...project,photo:image(1)});
    assert.equal(decoded,4,'different encoded content is admitted again');
    assert.equal(closed,decoded,'native bitmaps are not retained in the cache');
  } finally { globalThis.createImageBitmap = native; }
});

test('failed native validation is never cached and the same content can be retried', async () => {
  let calls = 0, closed = 0;
  const native = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (async () => { calls++; return {width:calls === 1 ? 99 : 2,height:3,close:() => {closed++;}} as ImageBitmap; }) as typeof createImageBitmap;
  try {
    const validate = createProjectImageValidator(), project = {...createProject(),photo:image()};
    await assert.rejects(validate(project), /decoded.*dimensions/i);
    await validate(project); await validate(project);
    assert.equal(calls,2); assert.equal(closed,2);
  } finally { globalThis.createImageBitmap = native; }
});

test('bounded validation cache evicts old content and oversized entries are not retained', async () => {
  let calls = 0;
  const native = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (async () => { calls++; return {width:2,height:3,close:() => {}} as ImageBitmap; }) as typeof createImageBitmap;
  try {
    const one = createProjectImageValidator(image().dataUrl.length * 2);
    const project = createProject();
    await one({...project,photo:image(1)}); await one({...project,photo:image(1)});
    await one({...project,photo:image(2)}); await one({...project,photo:image(1)});
    assert.equal(calls,3,'one-entry byte budget evicts the first content');
    const disabled = createProjectImageValidator(0);
    await disabled({...project,photo:image()}); await disabled({...project,photo:image()});
    assert.equal(calls,5,'content larger than the budget is checked on each call');
  } finally { globalThis.createImageBitmap = native; }
});

test('caller mutation while decoding cannot turn a dimension mismatch into cached success', async () => {
  const native = globalThis.createImageBitmap;
  let release!: (bitmap: ImageBitmap) => void, calls = 0;
  globalThis.createImageBitmap = (async () => { calls++; return new Promise<ImageBitmap>(resolve => {release = resolve;}); }) as typeof createImageBitmap;
  try {
    const validate = createProjectImageValidator(), project = {...createProject(),photo:image()};
    const waiting = validate(project);
    project.photo.width = 99;
    release({width:99,height:3,close:() => {}} as ImageBitmap);
    await assert.rejects(waiting, /decoded.*dimensions/i);
    project.photo.width = 2;
    const retry = validate(project);
    release({width:2,height:3,close:() => {}} as ImageBitmap);
    await retry; await validate(project);
    assert.equal(calls,2);
  } finally { globalThis.createImageBitmap = native; }
});
