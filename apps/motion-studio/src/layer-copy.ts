import { validateProject, type Project } from './model.ts';

/** Reuse complete vector artwork and motion; imported bitmap ownership stays unchanged. */
export function duplicateDrawingLayer(input: Project, layerId: string, newId: string = crypto.randomUUID()): Project {
  const project = validateProject(input), index = project.layers.findIndex(layer => layer.id === layerId);
  const source = project.layers[index];
  if (!source || source.kind !== 'drawing') throw new Error('Select an existing drawing layer to duplicate.');
  const copy = structuredClone(source); copy.id = newId;
  let prefix = '';
  for (const character of source.name) { if (prefix.length + character.length > 35) break; prefix += character; }
  copy.name = `${prefix} copy`;
  project.layers.splice(index + 1, 0, copy);
  return validateProject(project);
}
