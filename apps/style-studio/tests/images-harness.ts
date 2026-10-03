import { normalizePhoto, validateProjectPhotos, exportLookPng } from '../src/images.ts';
import { inspectPhotoHeader, validatePhotoAsset } from '../src/photo-header.ts';
const harness = { normalizePhoto, validateProjectPhotos, exportLookPng, inspectPhotoHeader, validatePhotoAsset };
declare global { interface Window { imageHarness: typeof harness } }
window.imageHarness = harness;
document.querySelector('#ready')!.textContent = 'Actual image modules ready';
