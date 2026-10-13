import type { Project } from './model.ts';
import { LIMITS } from './product.ts';
import { validatePhoto, validateRaster } from './media.ts';
/** Decode sequentially so admission never holds all project images in memory together. */
export async function validateProjectImages(project: Project): Promise<void> {
  await validatePhoto(project.photo);
  for (const motif of project.product?.motifs ?? []) await validateRaster(motif, LIMITS.motifBytes, 2048);
  for (const art of project.product?.artwork ?? []) await validateRaster(art, LIMITS.artworkBytes, 4096);
}
