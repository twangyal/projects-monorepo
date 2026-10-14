import * as THREE from 'three';
/** Keep decal UVs on the same fabric triangles when their supporting garment deforms. */
export function deformArtwork(decal: THREE.BufferGeometry, rest: THREE.BufferGeometry, deformed: THREE.BufferGeometry): void {
  const original = rest.getAttribute('position'), moved = deformed.getAttribute('position'), vertices = decal.getAttribute('position'), index = rest.index;
  if (!index || original.count !== moved.count) throw new Error('Artwork needs matching garment vertices.');
  const triangle = new THREE.Triangle(), point = new THREE.Vector3(), closest = new THREE.Vector3(), weights = new THREE.Vector3(), mapped = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let vertex = 0; vertex < vertices.count; vertex++) {
    point.fromBufferAttribute(vertices, vertex);
    let best = Infinity, face = -1;
    // Clipped decal vertices lie on the original shell. Search bounding boxes first; nearest-face fallback handles roundoff.
    for (const bounded of [true, false]) {
      for (let n = 0; n < index.count; n += 3) {
        triangle.a.fromBufferAttribute(original, index.getX(n)); triangle.b.fromBufferAttribute(original, index.getX(n + 1)); triangle.c.fromBufferAttribute(original, index.getX(n + 2));
        if (bounded && (point.x < Math.min(triangle.a.x,triangle.b.x,triangle.c.x)-0.001 || point.x > Math.max(triangle.a.x,triangle.b.x,triangle.c.x)+0.001 || point.y < Math.min(triangle.a.y,triangle.b.y,triangle.c.y)-0.001 || point.y > Math.max(triangle.a.y,triangle.b.y,triangle.c.y)+0.001 || point.z < Math.min(triangle.a.z,triangle.b.z,triangle.c.z)-0.001 || point.z > Math.max(triangle.a.z,triangle.b.z,triangle.c.z)+0.001)) continue;
        triangle.closestPointToPoint(point, closest); const distance = closest.distanceToSquared(point);
        if (distance < best) { best = distance; face = n; }
        if (best < 1e-12) break;
      }
      if (face >= 0) break;
    }
    if (face < 0) throw new Error('The artwork has no supporting garment triangle.');
    const ia=index.getX(face),ib=index.getX(face+1),ic=index.getX(face+2);
    triangle.a.fromBufferAttribute(original,ia);triangle.b.fromBufferAttribute(original,ib);triangle.c.fromBufferAttribute(original,ic);
    triangle.closestPointToPoint(point,closest);triangle.getBarycoord(closest,weights);
    a.fromBufferAttribute(moved,ia);b.fromBufferAttribute(moved,ib);c.fromBufferAttribute(moved,ic);
    mapped.copy(a).multiplyScalar(weights.x).addScaledVector(b,weights.y).addScaledVector(c,weights.z);
    vertices.setXYZ(vertex,mapped.x,mapped.y,mapped.z);
  }
  vertices.needsUpdate=true;decal.computeVertexNormals();
}
