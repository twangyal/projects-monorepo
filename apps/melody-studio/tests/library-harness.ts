import { CompositionLibrary } from '../src/composition-library.ts';

// Built only with MELODY_TEST_HARNESS=1. Tests supply independent literal data.
Object.defineProperty(window, 'libraryHarness', { value: Object.freeze({ CompositionLibrary }) });
document.querySelector('#library-harness-ready')!.textContent = 'Composition library harness ready';
