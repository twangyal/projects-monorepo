import { bodyProxy, buildCloth, type TopBodyShape } from './garment-drape.ts';
import { material, optionsOf, teeMesh, validateProduct, type Product, type PartId } from './product.ts';

type Triangulator = Parameters<typeof teeMesh>[1];
/**
 * Research interchange, not a native solver input. In particular, native UVs
 * orient material axes; they do not substitute for these structural rest lengths.
 * This module is not imported by the shipping workspace.
 */
export function captureNativeGarment(input: Product, chest: number, shape: TopBodyShape, triangulator: Triangulator) {
  const product = validateProduct(input);
  if (product.base !== 'tee' || optionsOf(product).chestPocket) throw new Error('Native research capture currently requires a plain tee without carried or layered parts.');
  const body = bodyProxy(product, chest, shape), meshes = teeMesh(product, triangulator), cloth = buildCloth(product, meshes);
  const members = new Map<number, { part: PartId; vertex: number }[]>();
  const parts = meshes.map(mesh => {
    const particles = [...cloth.vertices.get(mesh.part)!];
    particles.forEach((particle, vertex) => {
      const group = members.get(particle) ?? [];
      group.push({ part: mesh.part, vertex }); members.set(particle, group);
    });
    const fabric = material(product.parts[mesh.part].material);
    return {
      part: mesh.part, particles, triangles: [...mesh.indices],
      shell_positions_m: mesh.positions.map(n => n / 100),
      authored_uv_m: mesh.uvs.map(n => n / 100),
      material: { ...fabric }, areal_density_kg_m2: fabric.gsm / 1000,
      material_source: 'application-library-label-unmeasured' as const,
      rest_convention: mesh.part === 'neckband' ? 'wrapped-neckline-and-modelled-width' : 'flat-silhouette-xy',
    };
  });
  return {
    schema: 'clothing-native-garment-v1' as const,
    units: { length: 'm', mass: 'kg', time: 's', authored_uv: 'm', browser_compliance: 's^2/g' },
    scope: 'Research capture only; no native mapping, physical material or fit acceptance.',
    design: {
      base: product.base, name: product.name, measurements_cm: { ...product.measurements }, neckline: product.neckline,
      ...(product.fit ? { fit_cm: { ...product.fit } } : {}), ...(product.options ? { options: { ...product.options } } : {}),
    },
    positions_m: Array.from(cloth.positions, n => n / 100),
    particle_inverse_mass_per_kg: Array.from(cloth.inverseMass, n => n * 1000),
    body_clearance_m: Array.from(cloth.offset, n => n / 100),
    parts,
    seam_groups: [...members].filter(([, group]) => group.length > 1).map(([particle, group]) => ({ particle, members: group })),
    constraints: Array.from(cloth.rest, (rest, i) => ({
      particles: [cloth.a[i]!, cloth.b[i]!] as [number, number], rest_m: rest / 100,
      kind: cloth.structural[i] ? 'structural' as const : 'bending-distance' as const,
      // Retain the actual browser value with its own unit: this is NOT a normalized native coefficient.
      browser_compliance: cloth.compliance[i]!,
    })),
    body: {
      measurements_cm: { chest: body.chest, waist: body.waist, hip: body.hip, chestDepth: body.chestDepth },
      torso_m: body.torso.map(s => ({ y: s.y / 100, halfWidth: s.halfWidth / 100, halfDepth: s.halfDepth / 100 })),
      capsules_m: body.capsules.map(c => ({ a: c.a.map(n => n / 100), b: c.b.map(n => n / 100), radius: c.radius / 100, end: c.end / 100, limb: c.limb ?? false })),
      convention: 'analytic-union-of-stadium-sections-and-tapered-capsules-not-a-closed-native-triangle-collider',
    },
    native_material_parameters: null,
  };
}
