import { deformArtwork } from './artwork-deformation.ts';
import { mannequinMesh } from './body-mesh.ts';
import { ARTWORK_SHOULDER_OFFSET } from './artwork-placement.ts';
import type { BodyProxy, GarmentDrapeResult } from './garment-drape.ts';
// Real-time WebGL view of a product design: one mesh per part, physically scaled fabric tiles, artwork decals.
import * as THREE from 'three';
import Delaunator from 'delaunator';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STUDIO_HEIGHT, STUDIO_TURN, STUDIO_WIDTH, fabricLook, studioDistance, type StudioBackdrop, type StudioView } from './studio-render.ts';
import { paintTile, prepareMotifImages, tileSizeCm } from './fabric-texture.ts';
import { ARTWORK_PART_NAMES, JACKET_BUTTON_GAP_CM, LAPEL_UV_SHIFT, lapelShape, BELT_LOOP_CM, FLY_WIDTH_CM, OPEN_ZIP_GAP, isSleeveArtwork, sleeveArtworkFrame, sleeveArtworkUv, backPocketOf, frontPocketEdge, frontPocketOf, bottomsArtworkFrame, garmentHeight, isBottoms, material, optionsOf, type Material, partName, teeDimensions, teeMesh, topMeasurements, trouserDimensions, trouserYoke, type PartId, type PartMesh, type Product, zipAllowed, placketOf } from './product.ts';
/** A zip's width on the garment, tape included, cm. */
const ZIP_WIDTH = 1.4;

export type View = 'front' | 'back' | 'left' | 'right';
/** A convex polygon (clockwise in pattern cm, y down) with each edge moved `inset` cm inward. */
function insetPolygon(points: { x: number; y: number }[], inset: number): { x: number; y: number }[] {
  const n = points.length, lines = points.map((a, i) => {
    const b = points[(i + 1) % n]!, length = Math.hypot(b.x - a.x, b.y - a.y), normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    return { a: { x: a.x + normal.x * inset, y: a.y + normal.y * inset }, d: { x: b.x - a.x, y: b.y - a.y } };
  });
  return lines.map((line, i) => {
    const prev = lines[(i + n - 1) % n]!, cross = prev.d.x * line.d.y - prev.d.y * line.d.x;
    const t = ((line.a.x - prev.a.x) * line.d.y - (line.a.y - prev.a.y) * line.d.x) / cross;
    return { x: prev.a.x + prev.d.x * t, y: prev.a.y + prev.d.y * t };
  });
}
/** A turntable export turns once in this many seconds, at this frame rate. */
export const TURNTABLE_SECONDS = 6, TURNTABLE_FPS = 30, TURNTABLE_BACKDROP = 0xf1ebe0;

/** Meshes, materials and texture assets shared by the view and renderer-free GLB export. */
class ProductModel {
  protected group = new THREE.Group();
  /** The body a drape was simulated on; kept out of `group` so exports carry only the garment. */
  protected body = new THREE.Group();
  /** The garment worn with this one in an outfit drape; included only in explicit outfit exports, and not selectable. */
  protected worn = new THREE.Group();
  protected parts = new Map<PartId, THREE.Mesh>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private provisional: THREE.Texture[] = [];
  /** Artwork images still being drawn into their textures (see sleeveTexture). */
  private drawing: Promise<void>[] = [];
  private artworkTextures = new Map<string, THREE.Texture>();
  /** Artwork decals, which lie on a part's surface: the studio lets them take shadows but not cast them. */
  protected decals = new WeakSet<THREE.Object3D>();
  protected disposed = false;
  protected height = 72;
  protected low = 0;
  protected reframe() { /* No camera in a model-only export. */ }
  protected requestRender() { /* No renderer in a model-only export. */ }
  /** A fabric's surface. The studio renderer draws it with the soft sheen of its fibres (see StudioScene). */
  protected fabricSurface(fabric: Material, map: THREE.Texture, side: THREE.Side, highlighted = false): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map, roughness: 1 - fabric.sheen * 3, metalness: 0, side,
      emissive: new THREE.Color(highlighted ? 0x553311 : 0x000000), emissiveIntensity: highlighted ? 0.35 : 0 });
  }

  private texture(style: Product['parts'][PartId], motifs: Product['motifs'] = []): { texture: THREE.CanvasTexture; tileCm: number } {
    const motif = style.print?.motif.startsWith('upload:') ? motifs.find(m => `upload:${m.id}` === style.print!.motif)?.dataUrl ?? '' : '';
    const key = JSON.stringify([style, motif.length, motif.slice(-64)]);
    let texture = this.textures.get(key);
    const tileCm = tileSizeCm(style);
    if (!texture) {
      const painted = paintTile(style, undefined, motifs);
      texture = new THREE.CanvasTexture(painted.canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      if (this.textures.size > 40) { for (const old of this.textures.values()) old.dispose(); this.textures.clear(); }
      // A tile still waiting for its uploaded motif is repainted on the next update instead of being kept.
      if (painted.complete) this.textures.set(key, texture); else this.provisional.push(texture);
    }
    return { texture, tileCm };
  }

  /** Shows the product; with a drape, each part takes its simulated shape and the body it hangs on is shown, with the
   * `companion` garment of an outfit drape (and its third garment, `also`). */
  setProduct(product: Product, selected: PartId | null, drape: GarmentDrapeResult | null = null, showBody = true, companion: Product | null = null, also: Product | null = null) {
    for (const texture of this.provisional.splice(0)) texture.dispose();
    this.setBody(showBody ? drape?.body ?? null : null);
    for (const holder of [this.group, this.worn]) for (const child of [...holder.children]) { holder.remove(child); if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } }
    this.parts.clear();
    // The framing follows the garment: a hood rises above the shoulders, and trousers are long.
    const previous = [this.height, this.low];
    // A draped top is framed with the body's head in view.
    this.height = Math.max(garmentHeight(product), drape && showBody && !isBottoms(product) ? topMeasurements(product).length + 32 : 0) + 6;
    // Joggers' cuffs hang below their leg panels' hems.
    this.low = product.base === 'trousers' ? -trouserDimensions(product).cuffHeight : 0;
    // The other garments of an outfit drape, each with its settled parts.
    const worn = ([[companion, drape?.companion], [also, drape?.also]] as const).flatMap(([garment, settled]) => (garment && settled ? [{ garment, parts: settled.parts }] : []));
    if (worn.length) {
      // An outfit spans all its garments, with the head above the top's collar.
      let low = Infinity, high = -Infinity;
      for (const { positions } of [...drape!.parts, ...worn.flatMap(item => item.parts)]) for (let i = 1; i < positions.length; i += 3) { low = Math.min(low, positions[i]!); high = Math.max(high, positions[i]!); }
      this.low = Math.min(0, low - 4); this.height = Math.max(this.height, high + (showBody ? 32 : 6));
    }
    // A garment of a different height (another base, longer legs) is re-framed from the current side.
    if (Math.abs(this.height - previous[0]!) > 0.5 || Math.abs(this.low - previous[1]!) > 0.5) this.reframe();
    const wornMeshes = worn.map(({ garment, parts }) => {
      const rest = teeMesh(garment, Delaunator), meshes = new Map<PartId, THREE.Mesh>();
      for (const part of rest) {
        const positions = parts.find(item => item.part === part.part)?.positions;
        if (!positions || positions.length !== part.positions.length) continue;
        const mesh = this.partMesh(garment, part, positions, false), lining = this.liningMesh(garment, part, positions);
        mesh.name = `${garment.name}: ${mesh.name}`; mesh.userData = {};
        this.worn.add(mesh); meshes.set(part.part, mesh);
        if (lining) { lining.name = `${garment.name}: ${lining.name}`; this.worn.add(lining); }
      }
      return { garment, rest, meshes };
    });
    const restParts = teeMesh(product, Delaunator);
    for (const part of restParts) {
      const draped = drape?.parts.find(item => item.part === part.part);
      const shaped = !!draped && draped.positions.length === part.positions.length;
      const mesh = this.partMesh(product, part, shaped ? draped.positions : part.positions, part.part === selected);
      // A draped part keeps its unshaped surface, where artwork is placed from (see pickArtworkPoint).
      if (shaped) mesh.userData.rest = part.positions;
      this.group.add(mesh); this.parts.set(part.part, mesh);
      const lining = this.liningMesh(product, part, shaped ? draped.positions : part.positions);
      if (lining) this.group.add(lining);
    }
    this.group.updateMatrixWorld(true); this.worn.updateMatrixWorld(true);
    for (const { garment, rest, meshes } of wornMeshes) for (const art of garment.artwork) {
      const target = meshes.get(art.part);
      if (target) this.addArtwork(garment, art, rest.find(part => part.part === art.part)!, target, this.worn);
    }
    for (const art of product.artwork) this.addArtwork(product, art, drape ? restParts.find(part => part.part === art.part)! : null);
    for (const { garment, rest, meshes } of wornMeshes) { this.addZip(garment, rest, meshes, this.worn); this.addButtons(garment, rest, meshes, this.worn); this.addTopstitching(garment, rest, meshes, this.worn); }
    this.addTopstitching(product, restParts, this.parts, this.group);
    this.addZip(product, drape ? restParts : null, this.parts, this.group);
    this.addButtons(product, drape ? restParts : null, this.parts, this.group);
    this.requestRender();
  }

  /** A front zip (a zip hoodie's or a bomber jacket's), down the centre front from the neck and on through the hem band. */
  private addZip(product: Product, rest: PartMesh[] | null, parts: Map<PartId, THREE.Mesh>, holder: THREE.Object3D) {
    if (!zipAllowed(product.base) || !optionsOf(product).zip) return;
    const d = teeDimensions(product), top = d.length - d.neckDepthFront, band = d.band;
    // Worn open, each front half carries its own side of the zip.
    const sides = optionsOf(product).zipOpen ? [1, -1] as const : [0] as const;
    for (const [part, low, high] of [['front', band, top], ['hemBand', 0, band]] as const) {
      const target = parts.get(part);
      if (!target || high - low < 0.5) continue;
      for (const side of sides) {
        // Closed, the slider is at the neck; open, it sits at the foot of the zip, in the hem band.
        const texture = this.zipTexture(product.parts.front.color, high - low, side ? part === 'hemBand' : part === 'front', side), width = side ? ZIP_WIDTH / 2 : ZIP_WIDTH;
        this.addDecal(texture, { front: true, x: side * (OPEN_ZIP_GAP + width / 2), y: (low + high) / 2, width, height: high - low }, rest?.find(mesh => mesh.part === part) ?? null, target, holder,
          holder === this.worn ? `${product.name}: Zip` : 'Zip');
      }
    }
  }

  /** A polo's or shirt's buttons, down its placket from the neckline; worn open, on the wearer's right half only. A fly's
   * waistband has a metal shank button at the centre front. */
  private addButtons(product: Product, rest: PartMesh[] | null, parts: Map<PartId, THREE.Mesh>, holder: THREE.Object3D) {
    if (product.base === 'trousers') {
      const band = parts.get('waistband'), d = trouserDimensions(product);
      if (band && d.fly) this.addDecal(this.shankButtonTexture(), { front: true, x: 0, y: d.length + d.waistbandHeight / 2, width: 2, height: 2 },
        rest?.find(mesh => mesh.part === 'waistband') ?? null, band, holder, holder === this.worn ? `${product.name}: Waistband button` : 'Waistband button');
      return;
    }
    const lapels = !!optionsOf(product).lapels, target = parts.get(lapels ? 'front' : 'placket');
    if (!target) return;
    const d = teeDimensions(product), top = d.length - d.neckDepthFront, placket = placketOf(product), open = !!optionsOf(product).buttons && !!optionsOf(product).zipOpen;
    if (lapels) {
      // A jacket buttons below its lapels without a placket: the top button at the break point, the rest a jacket's gap
      // apart (see placketOf), on the wearer's left front when worn open.
      const count = placket.buttons, length = count * JACKET_BUTTON_GAP_CM, first = length * 0.75 / (count + 0.5), width = 3;
      this.addDecal(this.buttonTexture(product.parts.front.color, width, length, count, false), { front: true, x: open ? -(OPEN_ZIP_GAP + width / 2) : 0, y: d.length - (d.waistY - first) - length / 2, width, height: length },
        rest?.find(mesh => mesh.part === 'front') ?? null, target, holder, holder === this.worn ? `${product.name}: Buttons` : 'Buttons');
      return;
    }
    const width = open ? placket.width / 2 - OPEN_ZIP_GAP : placket.width, x = open ? -(OPEN_ZIP_GAP + width / 2) : 0, length = Math.min(placket.length, d.length - d.neckDepthFront - 0.5);
    this.addDecal(this.buttonTexture(product.parts.placket?.color ?? product.parts.front.color, width, length, placket.buttons), { front: true, x, y: top - length / 2, width, height: length },
      rest?.find(mesh => mesh.part === 'placket') ?? null, target, holder, holder === this.worn ? `${product.name}: Buttons` : 'Buttons');
  }

  /**
   * Trousers' topstitching, as jeans show it: a double row round each back pocket's sides and point and across its top,
   * along each front pocket's opening, along the back yoke's seam, on the yoke, in a J down the fly on the wearer's left
   * front, and across each belt loop's ends. Gold thread on denim, a shade darker than the fabric otherwise. Each is
   * drawn on a clear layer over its part, placed by the part's pattern coordinates, so it follows the drape.
   */
  private addTopstitching(product: Product, rest: PartMesh[], parts: Map<PartId, THREE.Mesh>, holder: THREE.Object3D) {
    if (product.base === 'tee' && optionsOf(product).lapels) {
      // A jacket's lapels are edge-stitched from the gorge round the point and down to the break, a shade darker than
      // their fabric, half a centimetre in (the fold along the roll line has none).
      const lapel = lapelShape(product), inset = insetPolygon(lapel.lapel, 0.5), edge = [inset[2]!, inset[3]!, inset[4]!, inset[5]!, inset[0]!];
      const thread = `#${new THREE.Color(product.parts.lapel!.color).multiplyScalar(0.7).getHexString()}`;
      this.addStitchLayer(product, 'lapel', rest, parts, holder, LAPEL_UV_SHIFT * 2, lapel.breakY + 2, thread, draw => {
        for (const side of [1, -1]) draw(edge.map(p => ({ x: side * p.x + LAPEL_UV_SHIFT, y: p.y })), false);
      });
      return;
    }
    if (product.base !== 'trousers') return;
    const thread = (part: PartId) => (material(product.parts[part]!.material).id.startsWith('denim') ? '#c9973f' : `#${new THREE.Color(product.parts[part]!.color).multiplyScalar(0.7).getHexString()}`);
    const pocket = optionsOf(product).backPockets ? backPocketOf(product) : null;
    if (pocket) {
      const { width: w, height: h, point } = pocket, outline = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: w / 2, y: point }, { x: 0, y: h }];
      this.addStitchLayer(product, 'backPocket', rest, parts, holder, w, point, thread('backPocket'), draw => {
        // Two rows in from the sides and the point (the outline's edges moved in), and two across the top hem.
        for (const inset of [0.3, 0.85]) {
          const ring = insetPolygon(outline, inset);
          draw([{ x: ring[1]!.x, y: 0 }, ring[2]!, ring[3]!, ring[4]!, { x: ring[0]!.x, y: 0 }], false);
        }
        for (const y of [1.5, 2.05]) draw([{ x: 0, y }, { x: w, y }], false);
      });
    }
    if (optionsOf(product).frontPockets) {
      // Two rows along each front pocket's curved opening, on the facing inside it.
      const { opening, depth } = frontPocketOf(product);
      this.addStitchLayer(product, 'frontPocket', rest, parts, holder, opening + 1.5, depth + 1, thread('frontPocket'), draw => {
        for (const inset of [0.3, 0.85]) draw(frontPocketEdge(product, -inset, 16), false);
      });
    }
    if (optionsOf(product).yoke) {
      const d = trouserDimensions(product), yoke = trouserYoke(product);
      const side = { x: 0.5 - 0.5 * yoke.side / d.hipDepth, y: d.backRaise + yoke.side }, centre = { x: d.backHip - 0.5 + 0.5 * yoke.back / (d.backRaise + d.hipDepth), y: yoke.back };
      const length = Math.hypot(centre.x - side.x, centre.y - side.y), up = { x: (centre.y - side.y) / length, y: -(centre.x - side.x) / length };
      this.addStitchLayer(product, 'yoke', rest, parts, holder, d.backHip, Math.max(side.y, centre.y) + 1, thread('yoke'), draw => {
        for (const gap of [0.3, 0.9]) draw([{ x: side.x + up.x * gap, y: side.y + up.y * gap }, { x: centre.x + up.x * gap, y: centre.y + up.y * gap }], false);
      });
    }
    const d = trouserDimensions(product);
    if (d.fly) {
      // Two rows down the fly, FLY_WIDTH_CM in from the centre front, curving into it at the foot of the zip: on the
      // wearer's left front leg only, the one that laps over the zip.
      const length = d.flyLength;
      this.addStitchLayer(product, 'front', rest, parts, holder, d.frontHip + d.frontCrotch, length + 2, thread('front'), draw => {
        for (const width of [FLY_WIDTH_CM - 0.3, FLY_WIDTH_CM + 0.3]) {
          const straight = Array.from({ length: 6 }, (_, i) => { const y = (length - width) * i / 5; return { x: d.centreAt(true, y) - width, y }; });
          const curve = Array.from({ length: 8 }, (_, i) => { const t = Math.PI / 2 * (i + 1) / 8, y = length - width + width * Math.sin(t); return { x: d.centreAt(true, y) - width * Math.cos(t), y }; });
          draw([...straight, ...curve], false);
        }
      }, 1);
    }
    if (d.fly && optionsOf(product).beltLoops) {
      // Each belt loop is stitched down both long edges and bar-tacked across its ends.
      const height = d.waistbandHeight + BELT_LOOP_CM.above + BELT_LOOP_CM.below;
      this.addStitchLayer(product, 'beltLoop', rest, parts, holder, BELT_LOOP_CM.width, height, thread('beltLoop'), draw => {
        for (const x of [0.2, BELT_LOOP_CM.width - 0.2]) draw([{ x, y: 0.15 }, { x, y: height - 0.15 }], false);
        for (const y of [0.35, 0.5, height - 0.5, height - 0.35]) draw([{ x: 0.15, y }, { x: BELT_LOOP_CM.width - 0.15, y }], false);
      });
    }
  }

  /** A jeans button: a metal disc with a raised rim and a shank, on a transparent ground. */
  private shankButtonTexture(): THREE.Texture {
    const key = 'shank-button', cached = this.artworkTextures.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    canvas.width = canvas.height = 64;
    const shine = context.createRadialGradient(26, 24, 2, 32, 32, 30);
    shine.addColorStop(0, '#f1d9a6'); shine.addColorStop(0.55, '#b98a45'); shine.addColorStop(1, '#6e4f22');
    context.fillStyle = shine; context.beginPath(); context.arc(32, 32, 30, 0, Math.PI * 2); context.fill();
    context.strokeStyle = '#5a3f19'; context.lineWidth = 3; context.beginPath(); context.arc(32, 32, 22, 0, Math.PI * 2); context.stroke();
    context.fillStyle = '#7d5a2a'; context.beginPath(); context.arc(32, 32, 6, 0, Math.PI * 2); context.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.artworkTextures.set(key, texture);
    return texture;
  }

  /** A clear layer over `part` (in its current, possibly draped, place) with stitches drawn in its pattern cm, which run
   * from 0 to `widthCm` across and `heightCm` down. With `half` (1 or -1), only over the part's triangles on that side
   * of the centre (x > 0 is the wearer's left). */
  private addStitchLayer(product: Product, part: PartId, rest: PartMesh[], parts: Map<PartId, THREE.Mesh>, holder: THREE.Object3D, widthCm: number, heightCm: number, colour: string,
    paint: (draw: (points: { x: number; y: number }[], closed: boolean) => void) => void, half: 1 | -1 | 0 = 0) {
    const target = parts.get(part), shape = rest.find(mesh => mesh.part === part);
    if (!target || !shape) return;
    const key = `stitch:${part}:${half}:${colour}:${widthCm.toFixed(2)}:${heightCm.toFixed(2)}:${product.base}:${JSON.stringify(product.measurements)}:${JSON.stringify(product.options ?? {})}`;
    let texture = this.artworkTextures.get(key);
    if (!texture) {
      const scale = 24, canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
      canvas.width = Math.max(4, Math.round(widthCm * scale)); canvas.height = Math.max(4, Math.round(heightCm * scale));
      context.strokeStyle = colour; context.lineWidth = 2; context.setLineDash([5, 3]); context.lineCap = 'round';
      paint((points, closed) => {
        context.beginPath();
        points.forEach((point, i) => (i ? context.lineTo(point.x * scale, point.y * scale) : context.moveTo(point.x * scale, point.y * scale)));
        if (closed) context.closePath();
        context.stroke();
      });
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.artworkTextures.set(key, texture);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(target.geometry.getAttribute('position').array as ArrayLike<number>), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(shape.uvs.map((value, i) => (i % 2 ? 1 - value / heightCm : value / widthCm)), 2));
    const P = shape.positions, indices = half ? shape.indices.filter((_, k) => { const t = k - (k % 3); return Math.sign(P[shape.indices[t]! * 3]! + P[shape.indices[t + 1]! * 3]! + P[shape.indices[t + 2]! * 3]!) === half; }) : shape.indices;
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const layer = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide, roughness: 0.9 }));
    layer.name = holder === this.worn ? `${product.name}: ${partName(product, part)} stitching` : `${partName(product, part)} stitching`;
    holder.add(layer);
  }

  /** `count` buttons evenly down a placket `widthCm` by `lengthCm`, with a stitched edge, on a transparent ground. */
  private buttonTexture(colour: string, widthCm: number, lengthCm: number, count: number, stitched = true): THREE.Texture {
    const key = `buttons:${colour}:${widthCm.toFixed(2)}:${lengthCm.toFixed(1)}:${count}:${stitched}`, cached = this.artworkTextures.get(key);
    if (cached) return cached;
    const scale = lengthCm > 40 ? 12 : 24, canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    canvas.width = Math.round(widthCm * scale); canvas.height = Math.round(lengthCm * scale);
    // The placket's edge stitching, a little darker than its fabric (a jacket's buttons have none round them).
    const thread = new THREE.Color(colour).multiplyScalar(0.7);
    context.strokeStyle = `#${thread.getHexString()}`; context.lineWidth = 1.5; context.setLineDash([4, 3]);
    if (stitched) context.strokeRect(scale * 0.25, 0, canvas.width - scale * 0.5, canvas.height - scale * 0.25);
    context.setLineDash([]);
    // Buttons a shade lighter or darker than the fabric, so they read on any colour.
    const fabric = new THREE.Color(colour), light = fabric.r * 0.2126 + fabric.g * 0.7152 + fabric.b * 0.0722 > 0.5;
    const button = light ? fabric.clone().multiplyScalar(0.82) : fabric.clone().lerp(new THREE.Color('#ffffff'), 0.55);
    for (let n = 0; n < count; n++) {
      const x = canvas.width / 2, y = canvas.height * (n + 0.75) / (count + 0.5), r = scale * 0.55;
      context.fillStyle = `#${button.getHexString()}`; context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.fill();
      context.fillStyle = `#${button.clone().multiplyScalar(0.6).getHexString()}`;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { context.beginPath(); context.arc(x + dx * r * 0.28, y + dy * r * 0.28, r * 0.12, 0, Math.PI * 2); context.fill(); }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.artworkTextures.set(key, texture);
    return texture;
  }

  /** Zip tape a little darker than the garment, light teeth every half centimetre and, at the top, the slider. `half` is
   * one side of an open zip: 1 for the wearer's left half (its teeth on its inner, viewer's left edge), -1 the right. */
  private zipTexture(colour: string, heightCm: number, slider: boolean, half: 0 | 1 | -1 = 0): THREE.Texture {
    const key = `zip:${colour}:${heightCm.toFixed(1)}:${slider}:${half}`;
    const cached = this.artworkTextures.get(key);
    if (cached) return cached;
    const scale = 20, canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    canvas.width = Math.round((half ? ZIP_WIDTH / 2 : ZIP_WIDTH) * scale); canvas.height = Math.max(8, Math.min(4096, Math.round(heightCm * scale)));
    const tape = new THREE.Color(colour).multiplyScalar(0.72);
    context.fillStyle = `#${tape.getHexString()}`; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#d6d6d2';
    const tooth = scale * 0.5, middle = half === 1 ? 0 : half === -1 ? canvas.width : canvas.width / 2;
    if (half) {
      // One row of teeth along the parting, each in the gap the other side's would fill.
      for (let y = half === 1 ? 0 : tooth / 2; y < canvas.height; y += tooth) context.fillRect(half === 1 ? 0 : canvas.width - scale * 0.22, y, scale * 0.22, tooth / 2 - 1);
    } else for (let y = 0, side = 0; y < canvas.height; y += tooth / 2, side ^= 1) context.fillRect(side ? middle : middle - scale * 0.22, y, scale * 0.22, tooth / 2 - 1);
    if (slider && half) {
      // The slider stays on the wearer's left half, at the top of its teeth; the right half carries the pin.
      context.fillStyle = half === 1 ? '#b9b9b4' : '#8f8f8a'; context.fillRect(0, canvas.height - scale * 1.2, canvas.width, scale * 1.2);
    } else if (slider) {
      context.fillStyle = '#b9b9b4'; context.fillRect(canvas.width * 0.12, 0, canvas.width * 0.76, scale * 1.4);
      context.fillStyle = '#8f8f8a'; context.fillRect(canvas.width * 0.38, scale * 1.4, canvas.width * 0.24, scale * 1.6);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.artworkTextures.set(key, texture);
    return texture;
  }

  /** One part's surface in its fabric, at `positions`. */
  private partMesh(product: Product, part: PartMesh, positions: ArrayLike<number>, highlighted: boolean): THREE.Mesh {
    const style = product.parts[part.part], { texture, tileCm } = this.texture(style, product.motifs);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // UVs are in cm; dividing by the tile's fabric size repeats it at physical scale.
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs.map(value => value / tileCm), 2));
    geometry.setIndex(part.indices); geometry.computeVertexNormals();
    // A lined part shows its fabric outside only; its lining is drawn inside (see liningMesh).
    const surface = this.fabricSurface(material(style.material), texture, this.lined(product, part) ? THREE.FrontSide : THREE.DoubleSide, highlighted);
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.name = partName(product, part.part); mesh.userData.part = part.part; mesh.userData.tileCm = tileCm;
    return mesh;
  }

  /** Whether a part is lined: a lined coat's body and sleeves. */
  private lined(product: Product, part: PartMesh): boolean {
    return !!optionsOf(product).lining && !!product.parts.lining && LINED_PARTS.has(part.part);
  }

  /** A lined part's lining, at `positions`: the same surface seen from inside, in the lining's fabric (the garment's
   * faces turn outward, so their backs face the body). Null for a part that is not lined. */
  private liningMesh(product: Product, part: PartMesh, positions: ArrayLike<number>): THREE.Mesh | null {
    if (!this.lined(product, part)) return null;
    const style = product.parts.lining!, { texture, tileCm } = this.texture(style, product.motifs), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs.map(value => value / tileCm), 2));
    geometry.setIndex(part.indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, this.fabricSurface(material(style.material), texture, THREE.BackSide));
    mesh.name = `${partName(product, part.part)} lining`; mesh.userData.lining = part.part;
    return mesh;
  }

  private setBody(body: BodyProxy | null) {
    for (const child of [...this.body.children]) { this.body.remove(child); if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } }
    if (!body) return;
    // One smooth mannequin: the torso the cloth rests on, blended with its arms, neck, head or legs.
    const { positions, indices } = mannequinMesh(body);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.8, metalness: 0 }));
    mesh.name = 'Body'; this.body.add(mesh);
  }

  private addArtwork(product: Product, art: Product['artwork'][number], rest: PartMesh | null, target = this.parts.get(art.part)!, holder = this.group) {
    let texture = this.artworkTextures.get(art.dataUrl);
    if (!texture) {
      const image = new Image(); image.src = art.dataUrl;
      texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace;
      image.decode().then(() => { if (!this.disposed) { texture!.needsUpdate = true; this.requestRender(); } }).catch(() => undefined);
      this.artworkTextures.set(art.dataUrl, texture);
    }
    if (isSleeveArtwork(art.part)) {
      const name = `${ARTWORK_PART_NAMES[art.part][0]!.toUpperCase()}${ARTWORK_PART_NAMES[art.part].slice(1)} artwork`;
      this.addSleeveArtwork(product, art, target, holder, holder === this.worn ? `${product.name}: ${name}` : name);
      return;
    }
    // Positions are measured from the shoulder line on tops, and from the waist seam on bottoms.
    const top = isBottoms(product) ? bottomsArtworkFrame(product).top : topMeasurements(product).length - ARTWORK_SHOULDER_OFFSET;
    const front = art.part === 'front', heightCm = art.widthCm * art.height / art.width;
    const name = `${front ? 'Front' : 'Back'} artwork`;
    this.addDecal(texture, { front, x: front ? art.xCm : -art.xCm, y: top - art.yCm - heightCm / 2, width: art.widthCm, height: heightCm, rotation: art.rotation ?? 0 }, rest, target, holder,
      holder === this.worn ? `${product.name}: ${name}` : name, art.part);
  }

  /** An image projected straight onto a part from outside, centred at (x, y) in cm; draped parts carry it along. */
  private addDecal(texture: THREE.Texture, at: { front: boolean; x: number; y: number; width: number; height: number; rotation?: number }, rest: PartMesh | null,
    target: THREE.Mesh, holder: THREE.Object3D, name: string, part: PartId | null = null) {
    let supporting = target;
    let restGeometry: THREE.BufferGeometry | null = null;
    if (rest) { restGeometry = new THREE.BufferGeometry(); restGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rest.positions,3)); restGeometry.setIndex(rest.indices); restGeometry.computeVertexNormals(); supporting = new THREE.Mesh(restGeometry,target.material); supporting.updateMatrixWorld(true); }
    const ray = new THREE.Raycaster(new THREE.Vector3(at.x, at.y, at.front ? 200 : -200), new THREE.Vector3(0, 0, at.front ? -1 : 1));
    const hit = ray.intersectObject(supporting)[0];
    if (!hit) { restGeometry?.dispose(); return; }
    const orientation = new THREE.Euler(0, at.front ? 0 : Math.PI, -(at.rotation ?? 0) * Math.PI / 180);
    let geometry: THREE.BufferGeometry;
    try { geometry = new DecalGeometry(supporting, hit.point, orientation, new THREE.Vector3(at.width, at.height, 30)); if (restGeometry) deformArtwork(geometry,restGeometry,target.geometry); }
    finally { restGeometry?.dispose(); }
    const decal = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 }));
    decal.name = name; if (part) decal.userData.part = part;
    this.decals.add(decal); holder.add(decal);
  }

  /**
   * Artwork on a sleeve is printed on the sleeve's own surface, which carries its pattern piece's flat coordinates, so
   * it wraps round the arm and follows the drape as the cut piece does. It is drawn over the sleeve's triangles that
   * reach it, with an image that has a clear margin, so the triangles' parts beyond the artwork show nothing.
   */
  private addSleeveArtwork(product: Product, art: Product['artwork'][number], target: THREE.Mesh, holder: THREE.Object3D, name: string) {
    const { texture, inner } = this.sleeveTexture(art), toArt = sleeveArtworkUv(sleeveArtworkFrame(product), art), tileCm = target.userData.tileCm as number;
    const flat = target.geometry.getAttribute('uv'), index = target.geometry.index!, uvs = new Float32Array(flat.count * 2), faces: number[] = [];
    for (let v = 0; v < flat.count; v++) {
      const [u, w] = toArt(flat.getX(v) * tileCm, flat.getY(v) * tileCm);
      uvs[v * 2] = inner.left + u * inner.width; uvs[v * 2 + 1] = inner.bottom + w * inner.height;
    }
    const square = (i: number) => (uvs[i * 2]! - inner.left) / inner.width, height = (i: number) => (uvs[i * 2 + 1]! - inner.bottom) / inner.height;
    for (let f = 0; f < index.count; f += 3) {
      const corners = [index.getX(f), index.getX(f + 1), index.getX(f + 2)];
      if (Math.max(...corners.map(square)) < 0 || Math.min(...corners.map(square)) > 1 || Math.max(...corners.map(height)) < 0 || Math.min(...corners.map(height)) > 1) continue;
      faces.push(...corners);
    }
    if (!faces.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', target.geometry.getAttribute('position').clone());
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geometry.setIndex(faces); geometry.computeVertexNormals();
    // Printed on the outside only; sleeves are wound with their faces outward.
    const print = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 }));
    print.name = name; print.userData.part = art.part;
    holder.add(print);
  }

  /** The artwork's image inside a clear margin, and where the image lies in the texture (0 to 1 each way). */
  private sleeveTexture(art: Product['artwork'][number]): { texture: THREE.Texture; inner: { left: number; bottom: number; width: number; height: number } } {
    const pad = Math.max(2, Math.round(Math.max(art.width, art.height) / 64)), wide = art.width + pad * 2, tall = art.height + pad * 2;
    const inner = { left: pad / wide, bottom: pad / tall, width: art.width / wide, height: art.height / tall }, key = `sleeve:${art.dataUrl}`, cached = this.artworkTextures.get(key);
    if (cached) return { texture: cached, inner };
    const canvas = document.createElement('canvas'); canvas.width = wide; canvas.height = tall;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const image = new Image(); image.src = art.dataUrl;
    this.drawing.push(image.decode().then(() => {
      canvas.getContext('2d')?.drawImage(image, pad, pad, art.width, art.height);
      texture.needsUpdate = true; if (!this.disposed) this.requestRender();
    }).catch(() => undefined));
    this.artworkTextures.set(key, texture);
    return { texture, inner };
  }

  async prepareArtwork() {
    // Uploaded artwork decodes from its file; drawn textures (a zip) are ready already, and sleeve prints once drawn.
    await Promise.all([...this.artworkTextures.values()].map(texture => (texture.image instanceof HTMLImageElement ? texture.image.decode() : undefined)));
    await Promise.all(this.drawing);
    for (const texture of this.artworkTextures.values()) texture.needsUpdate = true;
  }

  async glb(includeWorn = false): Promise<ArrayBuffer> {
    const result = await new GLTFExporter().parseAsync(includeWorn ? [this.group, this.worn] : this.group, { binary: true, onlyVisible: true });
    if (!(result instanceof ArrayBuffer)) throw new Error('The 3D model could not be exported.');
    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.setBody(null);
    for (const child of [...this.group.children, ...this.worn.children]) if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
    }
    for (const texture of [...this.textures.values(), ...this.provisional, ...this.artworkTextures.values()]) texture.dispose();
    this.group.clear(); this.worn.clear(); this.parts.clear(); this.textures.clear(); this.provisional = []; this.artworkTextures.clear(); this.drawing = [];
  }
}

/** The parts a coat's lining lines: its body and sleeves. */
const LINED_PARTS: ReadonlySet<PartId> = new Set(['front', 'back', 'sleeveLeft', 'sleeveRight']);

export class ProductScene extends ProductModel {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  private controls: OrbitControls;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private view: View = 'front';

  constructor(private canvas: HTMLCanvasElement) {
    super();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.group); this.scene.add(this.body); this.scene.add(this.worn);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(60, 120, 160); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-120, 60, -140); this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false; this.controls.minDistance = 90; this.controls.maxDistance = 400;
    this.controls.addEventListener('change', () => this.requestRender());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.setView('front');
  }

  private resize() {
    if (this.disposed) return;
    const width = this.canvas.clientWidth || 600, height = this.canvas.clientHeight || 520;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.requestRender();
  }
  protected override requestRender() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderer.render(this.scene, this.camera); });
  }
  renderNow() { if (this.disposed) return; if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; } this.renderer.render(this.scene, this.camera); }

  setView(view: View) {
    this.view = view;
    // Taller products (a hood, trousers) are framed from further away.
    const span = this.height - this.low, middle = this.low + span / 2 + 4;
    const distance = 210 * Math.max(1, span / 80), direction = { front: [0, 0.12, 1], back: [0, 0.12, -1], left: [1, 0.12, 0], right: [-1, 0.12, 0] }[view];
    this.controls.target.set(0, middle, 0);
    this.camera.position.set(direction[0] * distance, middle + direction[1] * distance, direction[2] * distance);
    this.controls.update(); this.requestRender();
  }

  protected override reframe() { this.setView(this.view); }

  /** The part under a viewport point, if any. */
  pick(clientX: number, clientY: number): PartId | null {
    const box = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObjects([...this.parts.values()])[0];
    return hit ? hit.object.userData.part as PartId : null;
  }

  /** Visible surface to original fabric cm, including when the mesh is draped. */
  pickArtworkPoint(clientX:number, clientY:number, side:Product['artwork'][number]['part']) {
    const box=this.canvas.getBoundingClientRect();
    const pointer=new THREE.Vector2(((clientX-box.left)/box.width)*2-1,-((clientY-box.top)/box.height)*2+1);
    const ray=new THREE.Raycaster(); ray.setFromCamera(pointer,this.camera);
    const hit=ray.intersectObjects([...this.parts.values(),...this.body.children])[0];
    if (!hit?.uv || hit.object.userData.part!==side) return null;
    const scale=hit.object.userData.tileCm as number;
    // On bottoms, whose pattern coordinates run from each leg's side seam, the point in 3D places artwork instead: on a
    // draped part, the same spot of its triangle on the unshaped surface, which artwork is projected onto.
    let at=hit.point.clone();
    const rest=hit.object.userData.rest as ArrayLike<number>|undefined, shown=(hit.object as THREE.Mesh).geometry.getAttribute('position');
    if (rest && hit.face) {
      const corner=(source:ArrayLike<number>,i:number)=>new THREE.Vector3(source[i*3],source[i*3+1],source[i*3+2]);
      const {a,b,c}=hit.face, weights=new THREE.Vector3();
      THREE.Triangle.getBarycoord(hit.object.worldToLocal(hit.point.clone()),new THREE.Vector3().fromBufferAttribute(shown,a),new THREE.Vector3().fromBufferAttribute(shown,b),new THREE.Vector3().fromBufferAttribute(shown,c),weights);
      at=corner(rest,a).multiplyScalar(weights.x).add(corner(rest,b).multiplyScalar(weights.y)).add(corner(rest,c).multiplyScalar(weights.z));
    }
    return {part:side,x:hit.uv.x*scale,y:hit.uv.y*scale,at:{x:at.x,y:at.y}};
  }

  async png(view: View): Promise<Blob> {
    const position = this.camera.position.clone(), target = this.controls.target.clone();
    this.setView(view); this.renderNow();
    const blob = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, 'image/png'));
    this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update(); this.renderNow();
    if (!blob) throw new Error('The 3D view could not be exported.');
    return blob;
  }

  /**
   * A turntable video: the camera circles the garment once at the front view's height and distance, each frame drawn
   * and handed to the recorder in real time, so a `seconds`-long turn takes that long to record.
   */
  async turntable(seconds = TURNTABLE_SECONDS, fps = TURNTABLE_FPS): Promise<Blob> {
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(candidate => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate));
    if (!type || typeof this.canvas.captureStream !== 'function') throw new Error('This browser cannot record video. Export front and back PNG renders instead.');
    const position = this.camera.position.clone(), target = this.controls.target.clone();
    this.setView('front');
    const centre = this.controls.target.clone(), offset = this.camera.position.clone().sub(centre);
    const radius = Math.hypot(offset.x, offset.z), height = offset.y;
    const stream = this.canvas.captureStream(0), track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 }), chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    // Video has no transparency: record on the studio's warm backdrop.
    const clear = this.renderer.getClearColor(new THREE.Color()), alpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(TURNTABLE_BACKDROP, 1);
    recorder.start();
    try {
      // Each frame is drawn on time, so the turn lasts `seconds` however long drawing takes.
      const frames = Math.round(seconds * fps), start = performance.now();
      for (let frame = 0; frame <= frames; frame++) {
        if (this.disposed) throw new Error('The 3D view closed while recording.');
        const angle = 2 * Math.PI * frame / frames;
        this.camera.position.set(centre.x + radius * Math.sin(angle), centre.y + height, centre.z + radius * Math.cos(angle));
        this.camera.lookAt(centre); this.renderNow(); track.requestFrame();
        await new Promise(resolve => setTimeout(resolve, Math.max(0, start + (frame + 1) * 1000 / fps - performance.now())));
      }
    } finally {
      this.renderer.setClearColor(clear, alpha);
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      for (const each of stream.getTracks()) each.stop();
      this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update(); this.renderNow();
    }
    const blob = new Blob(chunks, { type: 'video/webm' });
    if (!blob.size) throw new Error('The turntable video could not be recorded.');
    return blob;
  }

  override dispose() {
    if (this.disposed) return;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0; this.resizeObserver.disconnect(); this.controls.dispose();
    super.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}

/**
 * An offscreen photo studio for presentation renders: soft light from all round (an image-based room environment), a
 * key light from the upper left whose shadows fall across the garment (under a collar, beside a sleeve), shading in
 * the folds (ground-truth ambient occlusion), fabrics with their fibres' sheen, and neutral tone mapping, which keeps
 * colours true. The garment turns for each view while the camera and lights stay put, as on a photographer's turntable.
 */
export class StudioScene extends ProductModel {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, STUDIO_WIDTH / STUDIO_HEIGHT, 1, 4000);
  private turntable = new THREE.Group();
  private key = new THREE.DirectionalLight(0xffffff, 1.5);
  private environment: THREE.Texture;

  constructor(private canvas = document.createElement('canvas')) {
    super();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(1); this.renderer.setSize(STUDIO_WIDTH, STUDIO_HEIGHT, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose(); room.dispose();
    this.scene.environment = this.environment; this.scene.environmentIntensity = 0.4;
    this.turntable.add(this.group, this.worn); this.scene.add(this.turntable);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005; this.key.shadow.normalBias = 0.35; this.key.shadow.radius = 3;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0xfff3e6, 0.25); fill.position.set(220, 40, 160); this.scene.add(fill);
  }

  protected override fabricSurface(fabric: Material, map: THREE.Texture, side: THREE.Side): THREE.MeshStandardMaterial {
    const look = fabricLook(fabric);
    // The sheen takes the fabric's own colour, so a dark cloth is not greyed by it.
    return new THREE.MeshPhysicalMaterial({ map, side, metalness: 0, roughness: look.roughness, sheen: 1, sheenColor: new THREE.Color().setScalar(look.sheen), sheenColorMap: map, sheenRoughness: look.sheenRoughness });
  }

  /** The garment as photographed from `view`, on `backdrop`, as a PNG of STUDIO_WIDTH × STUDIO_HEIGHT. */
  async png(view: StudioView, backdrop: StudioBackdrop): Promise<Blob> {
    this.turntable.rotation.y = STUDIO_TURN[view] * Math.PI / 180;
    this.turntable.updateMatrixWorld(true);
    const box = new THREE.Box3(), anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    for (const holder of [this.group, this.worn]) holder.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      box.expandByObject(object);
      object.receiveShadow = true; object.castShadow = !this.decals.has(object);
      const map = (object.material as THREE.MeshStandardMaterial).map;
      if (map) map.anisotropy = anisotropy;
    });
    if (box.isEmpty()) throw new Error('There is no garment to render.');
    const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const distance = studioDistance(size, this.camera.fov, this.camera.aspect);
    this.camera.position.set(centre.x, centre.y + distance * 0.05, centre.z + distance); this.camera.lookAt(centre);
    this.camera.near = Math.max(1, distance - size.length()); this.camera.far = distance + size.length(); this.camera.updateProjectionMatrix();
    // The key light: high on the left, in front of the garment, its shadow box just round the garment.
    const reach = size.length() / 2 + 10, shadow = this.key.shadow.camera;
    this.key.position.copy(centre).add(new THREE.Vector3(-0.5, 0.8, 0.9).normalize().multiplyScalar(reach + 200));
    this.key.target.position.copy(centre); this.key.target.updateMatrixWorld();
    shadow.left = -reach; shadow.right = reach; shadow.top = reach; shadow.bottom = -reach; shadow.near = 100; shadow.far = 2 * reach + 300; shadow.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
    // Shading in the folds, a few centimetres across, smoothed and multiplied into the lit image before tone mapping.
    const target = new THREE.WebGLRenderTarget(STUDIO_WIDTH, STUDIO_HEIGHT, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target), occlusion = new GTAOPass(this.scene, this.camera, STUDIO_WIDTH, STUDIO_HEIGHT);
    try {
      composer.setPixelRatio(1); composer.setSize(STUDIO_WIDTH, STUDIO_HEIGHT);
      occlusion.normalMaterial.side = THREE.DoubleSide;
      occlusion.updateGtaoMaterial({ radius: 8, distanceExponent: 1.5, thickness: 4, distanceFallOff: 1, scale: 1.2, samples: 16, screenSpaceRadius: false });
      occlusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      occlusion.blendIntensity = 0.8;
      composer.addPass(new RenderPass(this.scene, this.camera)); composer.addPass(occlusion); composer.addPass(new OutputPass());
      composer.render();
    } finally { occlusion.dispose(); composer.dispose(); target.dispose(); }
    // The backdrop is painted behind the render, so its colour is exact rather than tone mapped.
    const photo = document.createElement('canvas'); photo.width = STUDIO_WIDTH; photo.height = STUDIO_HEIGHT;
    const context = photo.getContext('2d');
    if (!context) throw new Error('The studio render could not be drawn.');
    if (backdrop === 'white') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, STUDIO_WIDTH, STUDIO_HEIGHT); }
    if (backdrop === 'studio') {
      // A warm paper backdrop, lit brightest behind the garment and falling off gently towards the corners.
      const glow = context.createRadialGradient(STUDIO_WIDTH / 2, STUDIO_HEIGHT * 0.42, STUDIO_WIDTH * 0.1, STUDIO_WIDTH / 2, STUDIO_HEIGHT * 0.5, STUDIO_HEIGHT * 0.75);
      glow.addColorStop(0, '#f6f1e8'); glow.addColorStop(1, '#ddd3c4');
      context.fillStyle = glow; context.fillRect(0, 0, STUDIO_WIDTH, STUDIO_HEIGHT);
    }
    context.drawImage(this.canvas, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => photo.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The studio render could not be exported.');
    return blob;
  }

  override dispose() {
    if (this.disposed) return;
    super.dispose();
    this.environment.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}

/** Own one immutable scene for the full asynchronous export and always release its resources. */
async function withProductSnapshot<T, M extends ProductModel>(create: () => M, product: Product, drape: GarmentDrapeResult | null, exportModel: (model: M) => Promise<T>, companion: Product | null = null, also: Product | null = null): Promise<T> {
  const snapshot = structuredClone(product), settled = drape ? structuredClone(drape) : null, worn = companion ? structuredClone(companion) : null, third = also ? structuredClone(also) : null;
  if ((worn && !settled?.companion) || (third && !settled?.also)) throw new Error('Drape the outfit and wait for it to settle before exporting its garments together.');
  await Promise.all([prepareMotifImages(snapshot.motifs ?? []), prepareMotifImages(worn?.motifs ?? []), prepareMotifImages(third?.motifs ?? [])]);
  const model = create();
  try {
    model.setProduct(snapshot, null, settled, false, worn, third);
    await model.prepareArtwork();
    return await exportModel(model);
  } finally { model.dispose(); }
}

const renderSnapshot = () => new ProductScene(document.createElement('canvas'));

export function productSnapshotRenders(product: Product, drape: GarmentDrapeResult | null = null): Promise<{ front: Blob; back: Blob }> {
  return withProductSnapshot(renderSnapshot, product, drape, async scene => ({front: await scene.png('front'), back: await scene.png('back')}));
}
export function productSnapshotPng(product: Product, view: 'front' | 'back', drape: GarmentDrapeResult | null = null, companion: Product | null = null, also: Product | null = null): Promise<Blob> {
  return withProductSnapshot(renderSnapshot, product, drape, scene => scene.png(view), companion, also);
}
export function productSnapshotTurntable(product: Product, drape: GarmentDrapeResult | null = null, companion: Product | null = null, also: Product | null = null): Promise<Blob> {
  return withProductSnapshot(renderSnapshot, product, drape, scene => scene.turntable(), companion, also);
}
export function productSnapshotStudio(product: Product, view: StudioView, backdrop: StudioBackdrop, drape: GarmentDrapeResult | null = null, companion: Product | null = null, also: Product | null = null): Promise<Blob> {
  return withProductSnapshot(() => new StudioScene(), product, drape, scene => scene.png(view, backdrop), companion, also);
}
export function productSnapshotGlb(product: Product, drape: GarmentDrapeResult | null = null, companion: Product | null = null, also: Product | null = null): Promise<ArrayBuffer> {
  return withProductSnapshot(() => new ProductModel(), product, drape, model => model.glb(!!companion), companion, also);
}
