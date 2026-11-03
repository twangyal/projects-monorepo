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
import { OPEN_ZIP_GAP, garmentHeight, isBottoms, material, optionsOf, partName, teeDimensions, teeMesh, topMeasurements, trouserDimensions, type PartId, type PartMesh, type Product } from './product.ts';
/** A zip's width on the garment, tape included, cm. */
const ZIP_WIDTH = 1.4;

export type View = 'front' | 'back' | 'left' | 'right';
/** A turntable export turns once in this many seconds, at this frame rate. */
export const TURNTABLE_SECONDS = 6, TURNTABLE_FPS = 30, TURNTABLE_BACKDROP = 0xf1ebe0;

export class ProductScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  /** The body a drape was simulated on; kept out of `group` so exports carry only the garment. */
  private body = new THREE.Group();
  /** The garment worn with this one in an outfit drape; included only in explicit outfit exports, and not selectable. */
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
    if (Math.abs(this.height - previous[0]!) > 0.5 || Math.abs(this.low - previous[1]!) > 0.5) this.setView(this.view);
    const wornMeshes = worn.map(({ garment, parts }) => {
      const rest = teeMesh(garment, Delaunator), meshes = new Map<PartId, THREE.Mesh>();
      for (const part of rest) {
        const positions = parts.find(item => item.part === part.part)?.positions;
        if (!positions || positions.length !== part.positions.length) continue;
        const mesh = this.partMesh(garment, part, positions, false);
        mesh.name = `${garment.name}: ${mesh.name}`; mesh.userData = {};
        this.worn.add(mesh); meshes.set(part.part, mesh);
      }
      return { garment, rest, meshes };
    });
    const restParts = teeMesh(product, Delaunator);
    for (const part of restParts) {
      const draped = drape?.parts.find(item => item.part === part.part);
      const mesh = this.partMesh(product, part, draped && draped.positions.length === part.positions.length ? draped.positions : part.positions, part.part === selected);
      this.group.add(mesh); this.parts.set(part.part, mesh);
    }
    this.group.updateMatrixWorld(true); this.worn.updateMatrixWorld(true);
    for (const { garment, rest, meshes } of wornMeshes) for (const art of garment.artwork) {
      const target = meshes.get(art.part);
      if (target) this.addArtwork(garment, art, rest.find(part => part.part === art.part)!, target, this.worn);
    }
    for (const art of product.artwork) this.addArtwork(product, art, drape ? restParts.find(part => part.part === art.part)! : null);
    for (const { garment, rest, meshes } of wornMeshes) this.addZip(garment, rest, meshes, this.worn);
    this.addZip(product, drape ? restParts : null, this.parts, this.group);
    this.requestRender();
  }

  /** A zip hoodie's zip, down the centre front from the neck and on through the hem band. */
  private addZip(product: Product, rest: PartMesh[] | null, parts: Map<PartId, THREE.Mesh>, holder: THREE.Object3D) {
    if (product.base !== 'hoodie' || !optionsOf(product).zip) return;
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

  private addArtwork(product: Product, art: Product['artwork'][number], rest: PartMesh | null, target = this.parts.get(art.part)!, holder = this.group) {
    let texture = this.artworkTextures.get(art.dataUrl);
    if (!texture) {
      const image = new Image(); image.src = art.dataUrl;
      texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace;
      image.decode().then(() => { if (!this.disposed) { texture!.needsUpdate = true; this.requestRender(); } }).catch(() => undefined);
      this.artworkTextures.set(art.dataUrl, texture);
    }
    const top = topMeasurements(product).length - ARTWORK_SHOULDER_OFFSET; // the shoulder line, where artwork positions are measured from
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
    holder.add(decal);
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
    // Uploaded artwork decodes from its file; drawn textures (a zip) are ready already.
    await Promise.all([...this.artworkTextures.values()].map(texture => (texture.image instanceof HTMLImageElement ? texture.image.decode() : undefined)));
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

  async glb(includeWorn = false): Promise<ArrayBuffer> {
    const result = await new GLTFExporter().parseAsync(includeWorn ? [this.group, this.worn] : this.group, { binary: true, onlyVisible: true });
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
async function withProductSnapshot<T>(product: Product, drape: GarmentDrapeResult | null, exportScene: (scene: ProductScene) => Promise<T>, companion: Product | null = null, also: Product | null = null): Promise<T> {
  const snapshot = structuredClone(product), settled = drape ? structuredClone(drape) : null, worn = companion ? structuredClone(companion) : null, third = also ? structuredClone(also) : null;
  if ((worn && !settled?.companion) || (third && !settled?.also)) throw new Error('Drape the outfit and wait for it to settle before exporting its garments together.');
  await Promise.all([prepareMotifImages(snapshot.motifs ?? []), prepareMotifImages(worn?.motifs ?? []), prepareMotifImages(third?.motifs ?? [])]);
  const scene = new ProductScene(document.createElement('canvas'));
  try {
    scene.setProduct(snapshot, null, settled, false, worn, third);
    await scene.prepareArtwork();
    return await exportScene(scene);
  } finally { scene.dispose(); }
}

export function productSnapshotRenders(product: Product, drape: GarmentDrapeResult | null = null): Promise<{ front: Blob; back: Blob }> {
  return withProductSnapshot(product, drape, async scene => ({front: await scene.png('front'), back: await scene.png('back')}));
}
export function productSnapshotPng(product: Product, view: 'front' | 'back', drape: GarmentDrapeResult | null = null, companion: Product | null = null, also: Product | null = null): Promise<Blob> {
  return withProductSnapshot(product, drape, scene => scene.png(view), companion, also);
}
export function productSnapshotTurntable(product: Product, drape: GarmentDrapeResult | null = null, companion: Product | null = null, also: Product | null = null): Promise<Blob> {
  return withProductSnapshot(product, drape, scene => scene.turntable(), companion, also);
}
export function productSnapshotGlb(product: Product, drape: GarmentDrapeResult | null = null, companion: Product | null = null, also: Product | null = null): Promise<ArrayBuffer> {
  return withProductSnapshot(product, drape, scene => scene.glb(!!companion), companion, also);
}
