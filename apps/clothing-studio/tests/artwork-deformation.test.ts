import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {deformArtwork} from '../src/artwork-deformation.ts';
test('artwork keeps fabric barycentric coordinates and UVs through unequal stretch and bending',()=>{
 const geometry=(positions:number[])=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex([0,1,2]);return g;};
 const rest=geometry([0,0,0,1,0,0,0,1,0]),moved=geometry([0,0,5,2,0,5,0,3,6]),decal=geometry([.25,.25,0,.5,.25,0,.25,.5,0]);
 decal.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1],2));const uv=Array.from(decal.getAttribute('uv').array);
 deformArtwork(decal,rest,moved);assert.deepEqual(Array.from(decal.getAttribute('position').array),[.5,.75,5.25,1,.75,5.25,.5,1.5,5.5]);assert.deepEqual(Array.from(decal.getAttribute('uv').array),uv);
 for(const g of [rest,moved,decal])g.dispose();
});
