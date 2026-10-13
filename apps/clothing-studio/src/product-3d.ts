// Real-time WebGL view of a product design: one mesh per part, physically scaled fabric tiles, artwork decals.
import * as THREE from 'three';
import Delaunator from 'delaunator';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { paintTile, tileSizeCm } from './fabric-texture.ts';
import { material, PART_NAMES, teeMesh, type PartId, type Product } from './product.ts';

export type View = 'front' | 'back' | 'left' | 'right';
export class ProductScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private parts = new Map<PartId, THREE.Mesh>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private provisional: THREE.Texture[] = [];
  private artworkTextures = new Map<string, THREE.Texture>();
  private frame = 0;
  private height = 72;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(60, 120, 160); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-120, 60, -140); this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false; this.controls.minDistance = 90; this.controls.maxDistance = 400;
    this.controls.addEventListener('change', () => this.requestRender());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.setView('front');
  }

  private resize() {
    const width = this.canvas.clientWidth || 600, height = this.canvas.clientHeight || 520;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.requestRender();
  }
  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderer.render(this.scene, this.camera); });
  }
  renderNow() { if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; } this.renderer.render(this.scene, this.camera); }

  setView(view: View) {
    // Taller products (a hood) are framed from further away.
    const distance = 210 * Math.max(1, this.height / 80), direction = { front: [0, 0.12, 1], back: [0, 0.12, -1], left: [1, 0.12, 0], right: [-1, 0.12, 0] }[view];
    this.controls.target.set(0, this.height / 2 + 4, 0);
    this.camera.position.set(direction[0] * distance, this.height / 2 + 4 + direction[1] * distance, direction[2] * distance);
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

  setProduct(product: Product, selected: PartId | null) {
    for (const texture of this.provisional.splice(0)) texture.dispose();
    for (const child of [...this.group.children]) { this.group.remove(child); if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } }
    this.parts.clear();
    // A hood rises well above the shoulders, so the framing grows with it.
    this.height = product.measurements.length + (product.base === 'hoodie' ? 36 : 6);
    for (const part of teeMesh(product, Delaunator)) {
      const style = product.parts[part.part], { texture, tileCm } = this.texture(style, product.motifs);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
      // UVs are in cm; dividing by the tile's fabric size repeats it at physical scale.
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs.map(value => value / tileCm), 2));
      geometry.setIndex(part.indices); geometry.computeVertexNormals();
      const surface = new THREE.MeshStandardMaterial({ map: texture, roughness: 1 - material(style.material).sheen * 3, metalness: 0, side: THREE.DoubleSide,
        emissive: new THREE.Color(part.part === selected ? 0x553311 : 0x000000), emissiveIntensity: part.part === selected ? 0.35 : 0 });
      const mesh = new THREE.Mesh(geometry, surface);
      mesh.name = PART_NAMES[part.part]; mesh.userData.part = part.part;
      this.group.add(mesh); this.parts.set(part.part, mesh);
    }
    this.group.updateMatrixWorld(true);
    for (const art of product.artwork) this.addArtwork(product, art);
    this.requestRender();
  }

  private addArtwork(product: Product, art: Product['artwork'][number]) {
    const target = this.parts.get(art.part)!;
    let texture = this.artworkTextures.get(art.dataUrl);
    if (!texture) {
      const image = new Image(); image.src = art.dataUrl;
      texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace;
      image.decode().then(() => { texture!.needsUpdate = true; this.requestRender(); }).catch(() => undefined);
      this.artworkTextures.set(art.dataUrl, texture);
    }
    const top = product.measurements.length - 4; // the shoulder line, where artwork positions are measured from
    const front = art.part === 'front', heightCm = art.widthCm * art.height / art.width;
    // Project straight onto the panel from outside, centred where the artwork's centre should sit.
    const x = front ? art.xCm : -art.xCm, y = top - art.yCm - heightCm / 2;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, front ? 200 : -200), new THREE.Vector3(0, 0, front ? -1 : 1));
    const hit = ray.intersectObject(target)[0];
    if (!hit) return;
    const orientation = new THREE.Euler(0, front ? 0 : Math.PI, 0);
    const geometry = new DecalGeometry(target, hit.point, orientation, new THREE.Vector3(art.widthCm, heightCm, 30));
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

  dispose() { this.controls.dispose(); this.renderer.dispose(); for (const texture of this.textures.values()) texture.dispose(); }
}
