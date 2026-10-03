import { releaseCamera } from './camera-cleanup.js';

const modelRetirement = new WeakMap();

function disposeModel(model) {
  // WebGazer 3.3.0's MediaPipe wrapper has no dispose(), but these owned resources do.
  // Never reset shared TF state: a fresh instance may already be using it.
  const pipeline = model?.pipeline;
  const detector = pipeline?.boundingBoxDetector;
  const resources = typeof model?.dispose === 'function' ? [model] : [
    pipeline?.meshDetector, pipeline?.irisModel, detector?.blazeFaceModel,
    detector?.anchors, detector?.inputSize,
  ];
  for (const resource of new Set(resources)) {
    try { resource?.dispose?.(); } catch { /* Continue releasing independently owned resources. */ }
  }
}

// Retired bundles have their own private state; unique IDs also isolate late DOM insertion.
export function identifyCamera(api, session) {
  api.params ??= {};
  for (const field of ['videoElementId', 'videoContainerId', 'videoElementCanvasId', 'faceOverlayId', 'faceFeedbackBoxId', 'gazeDotId']) {
    api.params[field] = `gaze-camera-${session}-${field}`;
  }
  const tracker = api.getTracker?.();
  if (!tracker || typeof tracker.getEyePatches !== 'function') return;
  let active = 0;
  let retired = false;
  let disposalStarted = false;
  const disposeWhenIdle = () => {
    if (!retired || active || disposalStarted) return;
    disposalStarted = true;
    Promise.resolve(tracker.model).then(disposeModel).catch(() => {});
  };
  const getEyePatches = tracker.getEyePatches;
  tracker.getEyePatches = async function (...args) {
    if (retired) return null;
    active++;
    try { return await getEyePatches.apply(this, args); }
    finally { active--; disposeWhenIdle(); }
  };
  modelRetirement.set(api, () => { retired = true; disposeWhenIdle(); });
}

export function retireCameraModel(api) {
  modelRetirement.get(api)?.();
}

export function retireCamera(api, document, window) {
  retireCameraModel(api);
  let observer = null;
  const finish = () => {
    observer?.disconnect();
    observer = null;
    releaseCamera(api, document);
  };
  const releaseAttachedStream = () => {
    const video = document.getElementById?.(api.params.videoElementId);
    if (!video?.srcObject) return false;
    finish();
    return true;
  };
  // A canceled getUserMedia request can attach a stream long before begin() resolves.
  if (window.MutationObserver) {
    observer = new window.MutationObserver(releaseAttachedStream);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (!releaseAttachedStream()) releaseCamera(api, document);
  return finish;
}
