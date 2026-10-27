import type { Project } from './model.ts';
import { LIMITS } from './product.ts';
import { validatePhoto, validatePhotoHeader, validateRaster, validateRasterHeader, type RasterAsset } from './media.ts';

/** Session-only proof of successful decoding; never retain native image resources. */
export function createProjectImageValidator(maxCacheBytes = 16 * 1024 * 1024): (project: Project) => Promise<void> {
  if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 0) throw new RangeError('Image validation cache size must be a nonnegative integer.');
  const cache = new Map<string, Set<string>>();
  let bytes = 0;
  async function admitted(asset: RasterAsset, policy: string, decode: () => Promise<void>): Promise<void> {
    const content = asset.dataUrl, tag = `${policy}:${asset.width}:${asset.height}`;
    const previous = cache.get(content);
    if (previous?.has(tag)) {
      cache.delete(content); cache.set(content, previous);
      return;
    }
    await decode();
    const size = content.length * 2;
    if (size > maxCacheBytes || maxCacheBytes === 0) return;
    // Another admission may have finished while this native decode was pending.
    let checks = cache.get(content);
    if (checks) cache.delete(content);
    else {
      while (cache.size && (bytes + size > maxCacheBytes || cache.size >= 64)) {
        const oldest = cache.keys().next().value!;
        cache.delete(oldest); bytes -= oldest.length * 2;
      }
      checks = new Set(); bytes += size;
    }
    checks.add(tag); cache.set(content, checks);
  }
  // Decode sequentially so a project never holds all its bitmaps at once.
  return async project => {
    if (project.photo) {
      const photo = { ...project.photo };
      validatePhotoHeader(photo);
      await admitted(photo, 'photo', () => validatePhoto(photo));
    }
    const products = [project.product, project.wornWith];
    for (const motif of products.flatMap(product => product?.motifs ?? [])) {
      const asset = { ...motif };
      validateRasterHeader(asset, LIMITS.motifBytes, 2048);
      await admitted(asset, 'motif', () => validateRaster(asset, LIMITS.motifBytes, 2048));
    }
    for (const art of products.flatMap(product => product?.artwork ?? [])) {
      const asset = { ...art };
      validateRasterHeader(asset, LIMITS.artworkBytes, 4096);
      await admitted(asset, 'artwork', () => validateRaster(asset, LIMITS.artworkBytes, 4096));
    }
  };
}

export const validateProjectImages = createProjectImageValidator();
