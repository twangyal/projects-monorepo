import { validateProject } from './domain.ts';
import { inspectPhotoHeader, validatePhotoAsset } from './photo-header.ts';
import { ID_PATTERN, LIMITS, type PhotoAsset, type Piece, type Project } from './types.ts';

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Image operation cancelled.', 'AbortError');
}
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = canvas.getContext('2d');
  if (!result) throw new Error('Canvas rendering is unavailable in this browser.');
  return result;
}
async function decode(source: Blob, signal?: AbortSignal): Promise<ImageBitmap> {
  check(signal);
  if (typeof createImageBitmap !== 'function') throw new Error('This browser does not support safe photo decoding.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' }); }
  catch { check(signal); throw new Error('The compressed photo could not be decoded.'); }
  if (signal?.aborted) { bitmap.close(); check(signal); }
  return bitmap;
}
async function encode(canvas: HTMLCanvasElement, mime: string, signal?: AbortSignal, quality?: number): Promise<Blob> {
  check(signal);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
  check(signal);
  if (!blob || !blob.size || blob.type !== mime) throw new Error('The browser could not encode this image.');
  return blob;
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
function bytes(asset: PhotoAsset): Uint8Array {
  const raw = atob(asset.dataUrl.slice('data:image/jpeg;base64,'.length));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
async function decodeAsset(value: PhotoAsset, signal?: AbortSignal): Promise<ImageBitmap> {
  const asset = validatePhotoAsset(value);
  const bitmap = await decode(new Blob([bytes(asset) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), signal);
  try {
    check(signal);
    if (bitmap.width !== asset.width || bitmap.height !== asset.height) throw new Error('Decoded photo dimensions do not match the saved asset.');
    return bitmap;
  } catch (error) { bitmap.close(); throw error; }
}
function webpWithoutExif(data: Uint8Array): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = [data.slice(0,12)];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  while (offset + 8 <= data.length) {
    const kind = String.fromCharCode(...data.subarray(offset,offset+4));
    const length = view.getUint32(offset+4,true), end = offset + 8 + length + length % 2;
    if (kind !== 'EXIF') {
      const chunk = data.slice(offset,end);
      if (kind === 'VP8X') chunk[8] &= ~8;
      parts.push(chunk);
    }
    offset = end;
  }
  new DataView(parts[0].buffer).setUint32(4,parts.reduce((sum,part)=>sum+part.length,0)-8,true);
  return new Blob(parts,{type:'image/webp'});
}
function orient(ctx: CanvasRenderingContext2D, orientation: number): void {
  if (orientation === 2) ctx.scale(-1,1);
  else if (orientation === 3) ctx.rotate(Math.PI);
  else if (orientation === 4) ctx.scale(1,-1);
  else if (orientation === 5) { ctx.rotate(Math.PI/2);ctx.scale(1,-1); }
  else if (orientation === 6) ctx.rotate(Math.PI/2);
  else if (orientation === 7) { ctx.rotate(Math.PI/2);ctx.scale(-1,1); }
  else if (orientation === 8) ctx.rotate(-Math.PI/2);
}
/** Native Blob decoding avoids external fetches and temporary object URLs entirely. */
export async function normalizePhoto(source: Blob, id: string, signal?: AbortSignal): Promise<PhotoAsset> {
  check(signal);
  if (!ID_PATTERN.test(id)) throw new Error('Photo ID must contain 32 lowercase hexadecimal characters.');
  if (!source.size || source.size > LIMITS.sourcePhotoBytes) throw new Error('Choose a nonempty photo of at most 8 MiB.');
  const data = new Uint8Array(await source.arrayBuffer()); check(signal);
  const header = inspectPhotoHeader(data, source.type);
  // WebP EXIF support differs between native decoders. Remove its orientation
  // before decoding and apply it exactly once, rather than guessing from pixels.
  const manualOrientation = header.format === 'webp' && header.orientation !== undefined;
  const bitmap = await decode(manualOrientation ? webpWithoutExif(data) : source, signal);
  let canvas: HTMLCanvasElement | undefined;
  try {
    canvas = document.createElement('canvas');
    check(signal);
    const swapped = header.orientation !== undefined && header.orientation >= 5 && header.orientation <= 8;
    const width = swapped && !manualOrientation ? header.height : header.width, height = swapped && !manualOrientation ? header.width : header.height;
    if (bitmap.width !== width || bitmap.height !== height) throw new Error('Decoded photo dimensions do not match its header and orientation.');
    canvas.width = canvas.height = LIMITS.photoSide;
    const ctx = context(canvas); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,720,720);
    const displayedWidth = manualOrientation && swapped ? bitmap.height : bitmap.width;
    const displayedHeight = manualOrientation && swapped ? bitmap.width : bitmap.height;
    const factor = Math.min(720 / displayedWidth, 720 / displayedHeight);
    ctx.save();ctx.translate(360,360);ctx.scale(factor,factor);
    if (manualOrientation) orient(ctx,header.orientation!);
    ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2,bitmap.width,bitmap.height);ctx.restore();
    for (const quality of [0.9,0.82,0.74,0.66,0.58,0.5,0.42,0.34,0.26,0.18,0.1]) {
      const blob = await encode(canvas, 'image/jpeg', signal, quality); check(signal);
      if (blob.size > LIMITS.photoBytes) continue;
      const encoded = new Uint8Array(await blob.arrayBuffer()); check(signal);
      return validatePhotoAsset({ id, mime:'image/jpeg', width:720, height:720, dataUrl:'data:image/jpeg;base64,' + base64(encoded) });
    }
    throw new Error('The normalized JPEG exceeds 200 KiB. Choose a simpler photo.');
  } finally { bitmap.close(); if (canvas) canvas.width = canvas.height = 0; }
}
export async function validateProjectPhotos(project: Project, signal?: AbortSignal): Promise<void> {
  check(signal);
  const safe = validateProject(project);
  for (const photo of safe.photos) {
    const bitmap = await decodeAsset(photo, signal);
    try { check(signal); } finally { bitmap.close(); }
  }
  check(signal);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, maximum: number, leading: number): void {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (ctx.measureText(line ? line + ' ' + word : word).width <= width) { line = line ? line + ' ' + word : word; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of word) {
        if (ctx.measureText(line + character).width > width && line) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  if (lines.length > maximum) {
    lines.length = maximum;
    let tail = lines[maximum - 1];
    while (ctx.measureText(tail + '…').width > width && tail) tail = Array.from(tail).slice(0,-1).join('');
    lines[maximum - 1] = tail + '…';
  }
  for (let index = 0; index < lines.length; index++) ctx.fillText(lines[index], x, y + index * leading);
}
/** Original garment drawings describe the declared category/palette, not a fitted body. */
function garment(ctx: CanvasRenderingContext2D, piece: Piece, x: number, y: number): void {
  const palette = { neutral:'#7C6A54', warm:'#B56F48', cool:'#426CB1', bright:'#BA5492' };
  ctx.save();
  try {
    ctx.translate(x,y); ctx.fillStyle = palette[piece.tags.palette]; ctx.strokeStyle = '#3E3B36'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    if (piece.category === 'top') {
      const half = piece.tags.fit === 'relaxed' ? 77 : piece.tags.fit === 'fitted' ? 56 : 66;
      ctx.beginPath();ctx.moveTo(-half,-82);ctx.lineTo(-108,-38);ctx.lineTo(-79,-12);ctx.lineTo(-half,-30);ctx.lineTo(-half,93);ctx.lineTo(half,93);ctx.lineTo(half,-30);ctx.lineTo(79,-12);ctx.lineTo(108,-38);ctx.lineTo(half,-82);ctx.lineTo(24,-94);ctx.quadraticCurveTo(0,-64,-24,-94);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.strokeStyle='#F8F4EA';ctx.lineWidth=3;
      if (piece.tags.style === 'classic') { ctx.beginPath();ctx.moveTo(0,-69);ctx.lineTo(0,70);ctx.stroke();for(let yy=-45;yy<70;yy+=25){ctx.beginPath();ctx.arc(0,yy,2,0,Math.PI*2);ctx.fillStyle='#F8F4EA';ctx.fill();} }
      if (piece.tags.style === 'sporty') { for(const yy of [-20,-8]){ctx.beginPath();ctx.moveTo(-half,yy);ctx.lineTo(half,yy);ctx.stroke();} }
      if (piece.tags.style === 'playful') {ctx.fillStyle='#F8F4EA';for(const xx of [-30,0,30])for(const yy of [-10,25,60]){ctx.beginPath();ctx.arc(xx,yy,4,0,Math.PI*2);ctx.fill();}}
    } else if (piece.category === 'bottom') {
      const half = piece.tags.fit === 'relaxed' ? 70 : piece.tags.fit === 'fitted' ? 48 : 58;
      ctx.beginPath();ctx.moveTo(-half,-108);ctx.lineTo(half,-108);ctx.lineTo(half+9,100);ctx.lineTo(14,100);ctx.lineTo(0,-8);ctx.lineTo(-14,100);ctx.lineTo(-half-9,100);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(-half,-86);ctx.lineTo(half,-86);ctx.moveTo(0,-108);ctx.lineTo(0,-46);ctx.stroke();
      ctx.strokeStyle='#F8F4EA';ctx.lineWidth=2;for(const xx of [-half+12,half-12]){ctx.beginPath();ctx.moveTo(xx,-80);ctx.lineTo(xx,85);ctx.stroke();}
    } else {
      for (const offset of [-53,53]) {
        ctx.save();ctx.translate(offset,0);ctx.rotate(offset < 0 ? -.12 : .12);
        ctx.beginPath();ctx.moveTo(-43,42);ctx.lineTo(-42,-53);ctx.quadraticCurveTo(-10,-77,21,-32);ctx.lineTo(42,17);ctx.quadraticCurveTo(60,39,35,46);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle='#F8F4EA';ctx.lineWidth=4;for(const yy of [-25,-8,9]){ctx.beginPath();ctx.moveTo(-25,yy);ctx.lineTo(13,yy);ctx.stroke();}ctx.strokeStyle='#3E3B36';ctx.restore();
      }
    }
  } finally { ctx.restore(); }
}
export async function exportLookPng(project: Project, lookId: string, signal?: AbortSignal): Promise<Blob> {
  check(signal);
  const safe = validateProject(project);
  const look = safe.looks.find(value => value.id === lookId);
  if (!look) throw new Error('Choose an existing saved look to export.');
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1000;
  const decoded = new Map<string, ImageBitmap>();
  try {
    for (const piece of look.pieces) if (piece.photoId !== null && !decoded.has(piece.photoId)) {
      const photo = safe.photos.find(value => value.id === piece.photoId)!;
      const bitmap = await decodeAsset(photo,signal);
      decoded.set(piece.photoId,bitmap);check(signal);
    }
    check(signal);
    const ctx = context(canvas);ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,1200,1000);ctx.textBaseline='alphabetic';
    ctx.fillStyle='#665F55';ctx.font='20px sans-serif';wrap(ctx,safe.title,64,57,1072,1,24);
    ctx.fillStyle='#252C28';ctx.font='bold 38px sans-serif';wrap(ctx,look.name,64,114,1072,2,44);
    ctx.fillStyle='#665F55';ctx.font='16px sans-serif';ctx.fillText('Saved outfit · your declared tags · local photo references',64,192);
    const cardWidth=344;
    for(let index=0;index<look.pieces.length;index++) {
      const piece=look.pieces[index],x=64+index*364;
      ctx.fillStyle='#F4F1EB';ctx.fillRect(x,230,cardWidth,480);
      ctx.fillStyle='#665F55';ctx.font='bold 13px sans-serif';ctx.fillText(piece.category.toUpperCase(),x+22,254);
      if(piece.photoId!==null)ctx.drawImage(decoded.get(piece.photoId)!,x+37,272,270,270);
      else garment(ctx,piece,x+cardWidth/2,408);
      ctx.fillStyle='#252C28';ctx.font='bold 21px sans-serif';wrap(ctx,piece.name,x+22,582,cardWidth-44,2,27);
      ctx.fillStyle='#665F55';ctx.font='16px sans-serif';wrap(ctx,`${piece.tags.palette} · ${piece.tags.fit}`,x+22,654,cardWidth-44,1,20);
      wrap(ctx,`${piece.tags.style} · ${piece.tags.formality}`,x+22,679,cardWidth-44,1,20);
    }
    ctx.fillStyle='#252C28';ctx.font='bold 18px sans-serif';ctx.fillText('Notes',64,762);
    ctx.fillStyle='#665F55';ctx.font='18px sans-serif';wrap(ctx,look.notes||'No notes added.',64,796,1072,6,24);
    ctx.fillStyle='#665F55';ctx.font='14px sans-serif';ctx.fillText('Style Studio · reference photos and original garment sketches; not a try-on or fit prediction.',64,963);
    const blob=await encode(canvas,'image/png',signal);check(signal);return blob;
  } finally { for(const bitmap of decoded.values())bitmap.close();canvas.width=canvas.height=0; }
}
