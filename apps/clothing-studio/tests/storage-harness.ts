import { loadProject, saveProject, clearProject } from '../src/storage.ts';
import {template} from '../src/product.ts';
import { createProject } from '../src/model.ts';
export const harness = { loadProject, saveProject, clearProject, createProject,template };
declare global { interface Window { clothingStorage: typeof harness } }
window.clothingStorage = harness;
import * as designLibrary from '../src/design-library.ts';
declare global { interface Window { clothingDesignLibrary:typeof designLibrary } }
window.clothingDesignLibrary=designLibrary;
