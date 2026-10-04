import * as tween from '../src/tween.ts';
import { createTweenPreview } from '../src/tween-preview.ts';
import { exportGif } from '../src/export.ts';
import { createFrameRenderer } from '../src/render.ts';

declare global {
  interface Window { tweenHarness: typeof tween & { createTweenPreview: typeof createTweenPreview;
    exportGif: typeof exportGif; createFrameRenderer: typeof createFrameRenderer } }
}
window.tweenHarness = { ...tween, createTweenPreview, exportGif, createFrameRenderer };
document.querySelector('#ready')!.textContent = 'Actual tween modules ready';
