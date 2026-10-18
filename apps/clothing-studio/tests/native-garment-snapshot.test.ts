import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { template, teeMesh, withOptions, optionsOf } from '../src/product.ts';
import { buildCloth, bodyProxy } from '../src/garment-drape.ts';
import { captureNativeGarment } from '../src/native-garment-snapshot.ts';

test('native research capture retains actual topology, welds, UVs and rest constraints in SI', () => {
  const product = template('blank'), meshes = teeMesh(product, Delaunator), cloth = buildCloth(product, meshes);
  const packet = captureNativeGarment(product, 94, {}, Delaunator);
  assert.ok(packet, 'actual packet');
  assert.deepEqual(packet.design.measurements_cm, product.measurements);
  assert.equal(packet.schema, 'clothing-native-garment-v1');
  assert.deepEqual(packet.positions_m, Array.from(cloth.positions, n => n / 100));
  assert.deepEqual(packet.particle_inverse_mass_per_kg, Array.from(cloth.inverseMass, n => n * 1000));
  assert.equal(packet.constraints.length, cloth.rest.length);
  assert.deepEqual(packet.body_clearance_m, Array.from(cloth.offset, n => n / 100));
  packet.constraints.forEach((c, i) => {
    assert.deepEqual(c.particles, [cloth.a[i], cloth.b[i]]);
    assert.equal(c.rest_m, cloth.rest[i]! / 100);
    assert.equal(c.kind, cloth.structural[i] ? 'structural' : 'bending-distance');
    assert.equal(c.browser_compliance, cloth.compliance[i]);
  });
  assert.deepEqual(packet.parts.map(p => p.part), meshes.map(m => m.part));
  packet.parts.forEach((p, i) => {
    assert.deepEqual(p.triangles, meshes[i]!.indices);
    assert.deepEqual(p.authored_uv_m, meshes[i]!.uvs.map(v => v / 100));
    assert.deepEqual(p.particles, [...cloth.vertices.get(p.part)!]);
    assert.equal(p.areal_density_kg_m2, p.material.gsm / 1000);
  });
  assert.deepEqual(packet.body.measurements_cm, { chest:94,waist:94*.86,hip:94*1.02,chestDepth:bodyProxy(product,94).chestDepth });
  assert.ok(packet.seam_groups.length > 150);
  assert.equal(packet.body.capsules_m.length, 8);
  assert.ok(packet.parts.every(p => p.material_source === 'application-library-label-unmeasured'));
  assert.equal(packet.native_material_parameters, null, 'no XPBD-to-native coefficient copy');
});

test('capture owns values, is deterministic, and follows entered body and pattern edits', () => {
  const product = template('blank');
  const a = captureNativeGarment(product,94,{},Delaunator);
  assert.deepEqual(a,captureNativeGarment(product,94,{},Delaunator));
  product.fit={backNeckDrop:8};
  const b = captureNativeGarment(product,94,{waist:90,hip:110,chestDepth:24},Delaunator);
  assert.notDeepEqual(a.parts[1].authored_uv_m,b.parts[1].authored_uv_m);
  assert.notDeepEqual(a.body,b.body);
  assert.equal(a.design.fit_cm,undefined);
  b.positions_m[0]=123;
  assert.notEqual(captureNativeGarment(product,94,{waist:90,hip:110,chestDepth:24},Delaunator).positions_m[0],123);
});

test('initial bridge refuses unsupported carried/layered garments and invalid bodies', () => {
  for (const id of ['hoodie','crew-sweat','shorts']) assert.throws(() => captureNativeGarment(template(id),94,{},Delaunator), /plain tee/i);
  const p=withOptions(template('blank'),{...optionsOf(template('blank')), chestPocket:true});
  assert.throws(() => captureNativeGarment(p,94,{},Delaunator), /plain tee/i);
  assert.throws(() => captureNativeGarment(template('blank'),94,{chestDepth:44},Delaunator), /depth/i);
});
