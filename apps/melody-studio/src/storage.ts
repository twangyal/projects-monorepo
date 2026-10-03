import { parseComposition, serializeComposition } from './model.ts';
import type { Composition } from './types.ts';

export const STORAGE_KEY = 'melody-studio.project.v1';
export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadProject(storage: ProjectStorage | null): { project: Composition | null; error: string | null } {
  try {
    if (!storage) throw new Error('Storage unavailable');
    const json = storage.getItem(STORAGE_KEY);
    return { project: json ? parseComposition(json) : null, error: null };
  } catch {
    return { project: null, error: 'The saved project could not be read. It has not been deleted. Open a backup or start editing to save a new project.' };
  }
}

export function saveProject(storage: ProjectStorage | null, project: Composition): string | null {
  try {
    if (!storage) throw new Error('Storage unavailable');
    storage.setItem(STORAGE_KEY, serializeComposition(project));
    return null;
  } catch {
    return 'Changes are not saved in this browser. Save a project file to keep your work.';
  }
}
