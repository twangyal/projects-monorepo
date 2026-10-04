import { normalizePhoto, decodePhoto, validateProjectImages } from '../src/images.ts';
import { inspectPhotoHeader, validatePhotoAsset } from '../src/photo-header.ts';
import { createProject } from '../src/model.ts';
const imageHarness={ normalizePhoto, decodePhoto, validateProjectImages, inspectPhotoHeader, validatePhotoAsset, createProject };
declare global { interface Window { imageHarness:typeof imageHarness } }
window.imageHarness=imageHarness;
document.querySelector('#ready')!.textContent='Actual image modules ready';
