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
import { paintTile, prepareMotifImages, tileSizeCm } from './fabric-texture.ts';
import { garmentHeight, isBottoms, material, partName, teeMesh, topMeasurements, type PartId, type PartMesh, type Product } from './product.ts';

export type View = 'front' | 'back' | 'left' | 'right';
export class ProductScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  /** The body a drape was simulated on; kept out of `group` so exports carry only the garment. */
  private body = new THREE.Group();
  /** The garment worn with this one in an outfit drape; also kept out of exports, and not selectable. */
  private worn = new THREE.Group();
  private parts = new Map<PartId, THREE.Mesh>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private provisional: THREE.Texture[] = [];
  private artworkTextures = new Map<string, THREE.Texture>();
  private frame = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private height = 72;
  private low = 0;
  private view: View = 'front';

  constructor(private canvas: HTMLCanvasElement) {
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
  requestRender() {
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
   * `companion` garment of an outfit drape. */
  setProduct(product: Product, selected: PartId | null, drape: GarmentDrapeResult | null = null, showBody = true, companion: Product | null = null) {
    for (const texture of this.provisional.splice(0)) texture.dispose();
    this.setBody(showBody ? drape?.body ?? null : null);
    for (const holder of [this.group, this.worn]) for (const child of [...holder.children]) { holder.remove(child); if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } }
    this.parts.clear();
    // The framing follows the garment: a hood rises above the shoulders, and trousers are long.
    const previous = [this.height, this.low];
    // A draped top is framed with the body's head in view.
    this.height = Math.max(garmentHeight(product), drape && showBody && !isBottoms(product) ? topMeasurements(product).length + 32 : 0) + 6;
    this.low = 0;
    const worn = companion && drape?.companion ? drape.companion.parts : null;
    if (worn) {
      // An outfit spans both garments, with the head above the top's collar.
      let low = Infinity, high = -Infinity;
      for (const { positions } of [...drape!.parts, ...worn]) for (let i = 1; i < positions.length; i += 3) { low = Math.min(low, positions[i]!); high = Math.max(high, positions[i]!); }
      this.low = Math.min(0, low - 4); this.height = Math.max(this.height, high + (showBody ? 32 : 6));
    }
    // A garment of a different height (another base, longer legs) is re-framed from the current side.
    if (Math.abs(this.height - previous[0]!) > 0.5 || Math.abs(this.low - previous[1]!) > 0.5) this.setView(this.view);
    if (worn) for (const part of teeMesh(companion!, Delaunator)) {
      const positions = worn.find(item => item.part === part.part)?.positions;
      if (!positions || positions.length !== part.positions.length) continue;
      const mesh = this.partMesh(companion!, part, positions, false);
      mesh.name = `${companion!.name}: ${mesh.name}`; mesh.userData = {};
      this.worn.add(mesh);
    }
    const restParts = teeMesh(product, Delaunator);
    for (const part of restParts) {
      const draped = drape?.parts.find(item => item.part === part.part);
      const mesh = this.partMesh(product, part, draped && draped.positions.length === part.positions.length ? draped.positions : part.positions, part.part === selected);
      this.group.add(mesh); this.parts.set(part.part, mesh);
    }
    this.group.updateMatrixWorld(true);
    for (const art of product.artwork) this.addArtwork(product, art, drape ? restParts.find(part => part.part === art.part)! : null);
    this.requestRender();
  }

  /** One part's surface in its fabric, at `positions`. */
  private partMesh(product: Product, part: PartMesh, positions: ArrayLike<number>, highlighted: boolean): THREE.Mesh {
    const style = product.parts[part.part], { texture, tileCm } = this.texture(style, product.motifs);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // UVs are in cm; dividing by the tile's fabric size repeats it at physical scale.
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs.map(value => value / tileCm), 2));
    geometry.setIndex(part.indices); geometry.computeVertexNormals();
    const surface = new THREE.MeshStandardMaterial({ map: texture, roughness: 1 - material(style.material).sheen * 3, metalness: 0, side: THREE.DoubleSide,
      emissive: new THREE.Color(highlighted ? 0x553311 : 0x000000), emissiveIntensity: highlighted ? 0.35 : 0 });
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.name = partName(product, part.part); mesh.userData.part = part.part; mesh.userData.tileCm = tileCm;
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

  private addArtwork(product: Product, art: Product['artwork'][number], rest: PartMesh | null) {
    const target = this.parts.get(art.part)!;
    let texture = this.artworkTextures.get(art.dataUrl);
    if (!texture) {
      const image = new Image(); image.src = art.dataUrl;
      texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace;
      image.decode().then(() => { if (!this.disposed) { texture!.needsUpdate = true; this.requestRender(); } }).catch(() => undefined);
      this.artworkTextures.set(art.dataUrl, texture);
    }
    let supporting = target;
    let restGeometry: THREE.BufferGeometry | null = null;
    if (rest) { restGeometry = new THREE.BufferGeometry(); restGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rest.positions,3)); restGeometry.setIndex(rest.indices); restGeometry.computeVertexNormals(); supporting = new THREE.Mesh(restGeometry,target.material); supporting.updateMatrixWorld(true); }
    const top = topMeasurements(product).length - ARTWORK_SHOULDER_OFFSET; // the shoulder line, where artwork positions are measured from
    const front = art.part === 'front', heightCm = art.widthCm * art.height / art.width;
    // Project straight onto the panel from outside, centred where the artwork's centre should sit.
    const x = front ? art.xCm : -art.xCm, y = top - art.yCm - heightCm / 2;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, front ? 200 : -200), new THREE.Vector3(0, 0, front ? -1 : 1));
    const hit = ray.intersectObject(supporting)[0];
    if (!hit) { restGeometry?.dispose(); return; }
    const orientation = new THREE.Euler(0, front ? 0 : Math.PI, -(art.rotation ?? 0) * Math.PI / 180);
    let geometry: THREE.BufferGeometry;
    try { geometry = new DecalGeometry(supporting, hit.point, orientation, new THREE.Vector3(art.widthCm, heightCm, 30)); if (restGeometry) deformArtwork(geometry,restGeometry,target.geometry); }
    finally { restGeometry?.dispose(); }
    const decal = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 }));
    decal.name = `${front ? 'Front' : 'Back'} artwork`; decal.userData.part = art.part;
    this.group.add(decal);
  }

  /** The part under a viewport point, if any. */
  pick(clientX: number, clientY: number): PartId | null {
    const box = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObjects([...this.parts.values()])[0];
    return hit ? hit.object.userData.part as PartId : null;
  }

  /** Visible surface to original fabric cm, including when the mesh is draped. */
  pickArtworkPoint(clientX:number, clientY:number, side:'front'|'back') {
    const box=this.canvas.getBoundingClientRect();
    const pointer=new THREE.Vector2(((clientX-box.left)/box.width)*2-1,-((clientY-box.top)/box.height)*2+1);
    const ray=new THREE.Raycaster(); ray.setFromCamera(pointer,this.camera);
    const hit=ray.intersectObjects([...this.parts.values(),...this.body.children])[0];
    if (!hit?.uv || hit.object.userData.part!==side) return null;
    const scale=hit.object.userData.tileCm as number;
    return {part:side,x:hit.uv.x*scale,y:hit.uv.y*scale};
  }

  async prepareArtwork() {
    await Promise.all([...this.artworkTextures.values()].map(texture => (texture.image as HTMLImageElement).decode()));
    for (const texture of this.artworkTextures.values()) texture.needsUpdate = true;
  }

  async png(view: View): Promise<Blob> {
    const position = this.camera.position.clone(), target = this.controls.target.clone();
    this.setView(view); this.renderNow();
    const blob = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, 'image/png'));
    this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update(); this.renderNow();
    if (!blob) throw new Error('The 3D view could not be exported.');
    return blob;
  }

  async glb(): Promise<ArrayBuffer> {
    const result = await new GLTFExporter().parseAsync(this.group, { binary: true, onlyVisible: true });
    if (!(result instanceof ArrayBuffer)) throw new Error('The 3D model could not be exported.');
    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0; this.setBody(null); this.resizeObserver.disconnect(); this.controls.dispose();
    for (const child of [...this.group.children, ...this.worn.children]) if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
    }
    for (const texture of [...this.textures.values(), ...this.provisional, ...this.artworkTextures.values()]) texture.dispose();
    this.group.clear(); this.worn.clear(); this.parts.clear(); this.textures.clear(); this.provisional = []; this.artworkTextures.clear();
    this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}

/** Own one immutable scene for the full asynchronous export and always release its resources. */
async function withProductSnapshot<T>(product: Product, drape: GarmentDrapeResult | null, exportScene: (scene: ProductScene) => Promise<T>): Promise<T> {
  const snapshot = structuredClone(product), settled = drape ? structuredClone(drape) : null;
  await prepareMotifImages(snapshot.motifs ?? []);
  const scene = new ProductScene(document.createElement('canvas'));
  try {
    scene.setProduct(snapshot, null, settled, false);
    await scene.prepareArtwork();
    return await exportScene(scene);
  } finally { scene.dispose(); }
}

export function productSnapshotRenders(product: Product, drape: GarmentDrapeResult | null = null): Promise<{ front: Blob; back: Blob }> {
  return withProductSnapshot(product, drape, async scene => ({front: await scene.png('front'), back: await scene.png('back')}));
}
export function productSnapshotPng(product: Product, view: 'front' | 'back', drape: GarmentDrapeResult | null = null): Promise<Blob> {
  return withProductSnapshot(product, drape, scene => scene.png(view));
}
export function productSnapshotGlb(product: Product, drape: GarmentDrapeResult | null = null): Promise<ArrayBuffer> {
  return withProductSnapshot(product, drape, scene => scene.glb());
}
