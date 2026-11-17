/**
 * A person outline for a photo, from Google's MediaPipe pose landmarker (Apache-2.0), run in the browser. Its
 * WebAssembly runtime is bundled with the studio; the model (about 5.8 MB) is downloaded from Google's model storage
 * when first needed, pinned by path and checked against its SHA-256 before use. Photos never leave the device.
 *
 * The landmarker runs with its WebGL delegate: on the CPU delegate this version stops when asked for outlines. The
 * outline comes back as a floating-point texture, which many browsers cannot read back directly, so it is drawn from
 * black (not the person) to white (the person) on an ordinary canvas and read as 8-bit pixels.
 */
import type { Mask } from './body-photo.ts';
import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import binaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { fetchPoseModel } from './pose-model.ts';

/** Finds the person in a picture: their outline as a mask the size of the picture. */
export interface PoseDetector { outline(image: HTMLCanvasElement): Mask }

declare global {
  /** A replacement detector (for example in tests); when set, no model is downloaded. */
  var clothingPoseDetector: PoseDetector | undefined;
}

let loading: Promise<PoseDetector> | null = null;

/** The detector, loading the runtime and model once per page. */
export function loadPoseDetector(): Promise<PoseDetector> {
  if (globalThis.clothingPoseDetector) return Promise.resolve(globalThis.clothingPoseDetector);
  loading ??= (async () => {
    const [{ PoseLandmarker, DrawingUtils }, model] = await Promise.all([import('@mediapipe/tasks-vision'), fetchPoseModel()]);
    const surface = document.createElement('canvas');
    const landmarker = await PoseLandmarker.createFromOptions({ wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryUrl }, {
      baseOptions: { modelAssetBuffer: model, delegate: 'GPU' }, canvas: surface, runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true,
    });
    const gl = surface.getContext('webgl2');
    if (!gl) throw new Error('This browser cannot run the pose model (it needs WebGL 2).');
    return {
      outline(image: HTMLCanvasElement): Mask {
        let outline: Mask | null = null;
        landmarker.detect(image, result => {
          const found = result.segmentationMasks?.[0];
          if (!found || !result.landmarks.length) return;
          const target = document.createElement('canvas');
          target.width = found.width; target.height = found.height;
          const context = target.getContext('2d', { willReadFrequently: true })!, drawing = new DrawingUtils(context, gl);
          try {
            drawing.drawConfidenceMask(found, [0, 0, 0, 255], [255, 255, 255, 255]);
            const pixels = context.getImageData(0, 0, found.width, found.height).data, data = new Uint8Array(found.width * found.height);
            for (let i = 0; i < data.length; i++) data[i] = pixels[i * 4]! >= 128 ? 1 : 0;
            outline = { width: found.width, height: found.height, data };
          } finally { drawing.close(); }
        });
        if (!outline) throw new Error('No person was found in the photo.');
        return outline;
      },
    };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
