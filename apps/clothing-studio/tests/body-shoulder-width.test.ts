import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { bodyProxy, outfitBodies, simulateGarment, validateTopBodyShape, type TopBodyShape } from '../src/garment-drape.ts';
import { mannequinMesh } from '../src/body-mesh.ts';
import { template, teeMesh, patternPieces, validateProduct } from '../src/product.ts';
import { createProject, validateProject, serializeProject, parseProject, ProjectHistory } from '../src/model.ts';
import { validateBodyProfiles, validateProfileBody } from '../src/top-body-profiles.ts';
import { designDifferences } from '../src/design-diff.ts';

const measured = (shoulderWidth: unknown, extra = {}) => ({ shoulderWidth, ...extra }) as TopBodyShape;
const close = (a: number, b: number) => assert.ok(Math.abs(a-b)<1e-8, `${a} against ${b}`);

test('measured shoulders change proxy breadth and arm roots independently of garment shoulders', () => {
  const tee = template('ringer'), narrow = bodyProxy(tee, 94, measured(36)), broad = bodyProxy(tee, 94, measured(52));
  close(narrow.torso[0].halfWidth*2, 36); close(broad.torso[0].halfWidth*2, 52);
  assert.deepEqual(narrow.torso.slice(1), broad.torso.slice(1));
  assert.ok(broad.capsules[4].a[0] > narrow.capsules[4].a[0]);
  const altered = validateProduct({ ...tee, fit: { shoulderWidth: 44 } });
  const same = bodyProxy(altered, 94, measured(36));
  assert.deepEqual(same.torso, narrow.torso);
  assert.deepEqual(same.capsules, narrow.capsules);
});

test('measured arm roots cannot collapse automatic arm girth when aligned with a sleeve', () => {
  const hoodie=template('hoodie');
  for (const shoulderWidth of [37.3,40]) {
    const body=bodyProxy(hoodie,140,measured(shoulderWidth,{height:155,chestDepth:20}));
    assert.ok(body.capsules[4].radius>2,'an adult proxy arm must retain a nondegenerate radius');
    assert.ok(body.capsules[4].end>1,'the forearm must not collapse with the shoulder projection');
    const exact=bodyProxy(hoodie,140,measured(shoulderWidth,{height:155,chestDepth:20,upperArmGirth:30}));
    close(exact.capsules[4].radius*2*Math.PI,30);
  }
});

test('blank keeps legacy geometry and unsupported or capsule-crossing widths refuse', () => {
  const tee = template('ringer');
  assert.deepEqual(bodyProxy(tee,94),bodyProxy(tee,94,measured(undefined)));
  for (const shoulderWidth of [30,65]) assert.equal((validateTopBodyShape(94, measured(shoulderWidth)) as {shoulderWidth?:number}).shoulderWidth,shoulderWidth);
  for (const width of [29.99,65.01,NaN,Infinity,'42',null]) assert.throws(()=>validateTopBodyShape(94,measured(width)),/shoulder/i);
  assert.throws(()=>validateTopBodyShape(140,measured(30,{chestDepth:44})),/shoulder/i);
});

test('a recommended minimum shoulder width can actually be applied', () => {
  try { validateTopBodyShape(140,measured(30)); assert.fail('shoulder caps need more breadth'); }
  catch (error) {
    const minimum=/at least ([\d.]+) cm/.exec((error as Error).message);
    assert.ok(minimum);
    assert.doesNotThrow(()=>validateTopBodyShape(140,measured(Number(minimum[1]))));
  }
});

test('an outfit shares the measured shoulders while lower-body dimensions stay unchanged', () => {
  const tee=template('ringer'),trousers=template('trousers');
  const a=outfitBodies(tee,trousers,94,measured(36)),b=outfitBodies(tee,trousers,94,measured(52));
  close(a.body.torso[0].halfWidth*2,36);close(b.body.torso[0].halfWidth*2,52);
  assert.deepEqual(a.lower,b.lower);
});

test('shoulder width survives profiles, backups, history and body version comparison', () => {
  const body={chest:94,waist:null,hip:null,chestDepth:null,height:175,shoulderWidth:42.125};
  assert.deepEqual(validateProfileBody(body),body);
  assert.equal((validateProfileBody({...body,shoulderWidth:null}) as typeof body).shoulderWidth,null);
  assert.deepEqual(validateBodyProfiles({schema:1,kind:'clothing-top-body-profiles',profiles:[{name:'Measured',body}]}).profiles[0].body,body);
  const project={...createProject(),product:template('ringer')}, next=validateProject({...project,topBody:body});
  assert.deepEqual(parseProject(serializeProject(next)),next);
  assert.deepEqual(next.product,project.product);
  assert.deepEqual(patternPieces(next.product!),patternPieces(project.product));
  const history=new ProjectHistory(project);history.commit(next);assert.deepEqual(history.undo(),project);assert.deepEqual(history.redo(),next);
  assert.ok(designDifferences(project,next).some(line=>/Body shoulder width.*42.125 cm/.test(line)));
});

test('the mannequin and actual cloth solve use measured shoulders', () => {
  const tee=template('ringer'), meshes=teeMesh(tee,Delaunator), narrow=bodyProxy(tee,94,measured(36)), broad=bodyProxy(tee,94,measured(52));
  const a=mannequinMesh(narrow),b=mannequinMesh(broad);
  assert.notDeepEqual(a.positions,b.positions);assert.ok(b.positions.every(Number.isFinite));
  const first=simulateGarment(tee,meshes,94,{frames:60,bodyShape:measured(36)}),second=simulateGarment(tee,meshes,94,{frames:60,bodyShape:measured(52)});
  close(first.body.torso[0].halfWidth*2,36);close(second.body.torso[0].halfWidth*2,52);
  assert.ok(first.parts[0].positions.some((value,i)=>value!==second.parts[0].positions[i]));
  assert.ok(second.parts.every(part=>part.positions.every(Number.isFinite)));
  assert.ok(second.metrics.minClearance>=.34);
});
