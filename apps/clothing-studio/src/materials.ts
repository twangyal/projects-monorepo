/** The fabric library: every garment part, the drape test and the measured skirt choose from it. */
export interface Material { id: string; name: string; composition: string; gsm: number; texture: 'jersey' | 'rib' | 'pique' | 'slub' | 'terry' | 'linen' | 'twill' | 'canvas' | 'chiffon' | 'poplin'; tileCm: number; sheen: number }
export const MATERIALS: readonly Material[] = [
  { id: 'jersey-180', name: 'Cotton jersey', composition: '100% cotton, single jersey', gsm: 180, texture: 'jersey', tileCm: 1.2, sheen: 0.05 },
  { id: 'jersey-240', name: 'Heavyweight jersey', composition: '100% cotton, single jersey', gsm: 240, texture: 'jersey', tileCm: 1.6, sheen: 0.04 },
  { id: 'slub-160', name: 'Slub jersey', composition: '100% cotton, slub yarn', gsm: 160, texture: 'slub', tileCm: 6, sheen: 0.05 },
  { id: 'rib-220', name: '1×1 rib knit', composition: '95% cotton, 5% elastane', gsm: 220, texture: 'rib', tileCm: 1, sheen: 0.06 },
  { id: 'pique-200', name: 'Cotton piqué', composition: '100% cotton, piqué knit', gsm: 200, texture: 'pique', tileCm: 1.2, sheen: 0.05 },
  { id: 'terry-300', name: 'French terry', composition: '80% cotton, 20% polyester', gsm: 300, texture: 'terry', tileCm: 2, sheen: 0.03 },
  { id: 'chiffon-50', name: 'Chiffon', composition: '100% polyester, plain-weave chiffon', gsm: 50, texture: 'chiffon', tileCm: 2, sheen: 0.12 },
  { id: 'poplin-120', name: 'Cotton poplin', composition: '100% cotton, plain-weave poplin', gsm: 120, texture: 'poplin', tileCm: 2, sheen: 0.06 },
  { id: 'linen-170', name: 'Linen', composition: '100% linen, plain weave', gsm: 170, texture: 'linen', tileCm: 4, sheen: 0.08 },
  { id: 'denim-340', name: 'Denim twill', composition: '100% cotton, 3×1 twill', gsm: 340, texture: 'twill', tileCm: 2, sheen: 0.07 },
];

export function material(id: string): Material {
  const found = MATERIALS.find(item => item.id === id);
  if (!found) throw new Error('Choose a fabric from the library.');
  return found;
}
