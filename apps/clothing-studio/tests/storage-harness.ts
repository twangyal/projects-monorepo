import { loadProject, saveProject, clearProject } from '../src/storage.ts';
import { createProject } from '../src/model.ts';
export const harness = { loadProject, saveProject, clearProject, createProject };
declare global { interface Window { clothingStorage: typeof harness } }
window.clothingStorage = harness;
