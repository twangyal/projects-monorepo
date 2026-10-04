import { ProjectLibrary, SavedProjectConflict } from '../src/library-storage.ts';

// No fixture/model factory: all expectations and actual IDB inspection live in the independent browser test.
window.motionLibrary = Object.freeze({ ProjectLibrary, SavedProjectConflict });
declare global {
  interface Window { motionLibrary: { ProjectLibrary: typeof ProjectLibrary; SavedProjectConflict: typeof SavedProjectConflict } }
}
