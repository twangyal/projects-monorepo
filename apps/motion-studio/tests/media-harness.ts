import { importImage, inspectImageHeader, validateProjectImages } from '../src/images.ts';
import { closeAssets, loadAssets, renderFrame } from '../src/render.ts';
import { createDrawingLayer, createProject } from '../src/model.ts';
const harness = { importImage, inspectImageHeader, validateProjectImages, closeAssets, loadAssets, renderFrame, createDrawingLayer, createProject };
declare global { interface Window { mediaHarness: typeof harness } }
window.mediaHarness = harness;
document.querySelector('#ready')!.textContent = 'Actual media modules ready';
