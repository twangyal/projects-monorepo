import { validateProject, type Project } from './model.ts';
import { isBottoms } from './product.ts';

/** Switch the applied garment being edited; the outfit and its shared body stay together. */
export function switchOutfitEditing(project: Project): Project {
  const current = validateProject(project);
  if (!current.product || !current.wornWith || isBottoms(current.product) === isBottoms(current.wornWith)) {
    throw new Error('Choose a top and bottoms with Wear with before editing the worn garment.');
  }
  return validateProject({ ...current, product: current.wornWith, wornWith: current.product });
}
