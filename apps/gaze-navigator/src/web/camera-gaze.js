// Camera tracking source for the web navigator: owns one WebGazer session at a time.
// Estimator data stays in memory; stopping releases the stream even during startup.
import { createCameraLoader } from '../camera-loader.js';
import { resetCameraCalibration } from '../camera-calibration.js';
import { releaseCamera } from '../camera-cleanup.js';
import { identifyCamera, retireCamera, retireCameraModel } from '../camera-retirement.js';
import { createHeadModel, headFeatures } from './head-pointer.js';
import { createIrisModel, irisFeatures, MOVED_SPREAD } from './iris-gaze.js';

// A live camera's picture always changes a little (sensor noise). One that stays exactly the same for FROZEN_MS has
// frozen (a stalled driver, a virtual camera showing a still), and the estimates WebGazer keeps making from it would
// point at wherever the eyes were when it stopped, so they are treated as lost until the picture moves again.
// The picture is compared at SAMPLE_SIZE, large enough that averaging cannot hide the noise.
export const FROZEN_MS = 3000;
const SAMPLE_MS = 500, SAMPLE_SIZE = [64, 48];
// A head pose older than this is not paired with a calibration point: the face was lost since.
const POSE_MS = 500;
// A head away from where it was calibrated for this long is reported with each gaze point (see iris-gaze.js).
export const MOVED_MS = 1500;

export function createCameraGaze({ document, window, load = createCameraLoader(document, window), onGaze, onLost }) {
  let session = 0;
  let api = null;
  let state = 'off';
  let needsFresh = false;
  let startup = null;
  let frozen = false;
  let unwatch = null;
  // 'eyes': where the irises point (iris-gaze.js) once calibrated, WebGazer's own estimate until then or without
  // irises; 'head': where the head points (head-pointer.js). All come from the same face landmarks.
  let mode = 'eyes';
  const head = createHeadModel(), iris = createIrisModel();
  let pose = null, poseAt = -Infinity, eyes = null, eyesAt = -Infinity, lastPositions = null, awaySince = null;

  // The face model replaces its landmark list whenever it finds a face, so the same list means no face this frame.
  function readFace() {
    const positions = api?.getTracker?.()?.getPositions?.();
    if (!positions || positions === lastPositions) return null;
    lastPositions = positions;
    const video = document.getElementById?.(api?.params?.videoElementId ?? 'webgazerVideoFeed');
    const width = video?.videoWidth || 640, height = video?.videoHeight || 480;
    return { pose: headFeatures(positions, width, height), eyes: irisFeatures(positions, width, height) };
  }

  // WebGazer asks the face model for the face only; ask it for the irises too (its iris model is loaded with it). If
  // that ever fails, the face alone is found as before.
  async function withIrises(current) {
    let model = null;
    try { model = await api?.getTracker?.()?.model; } catch { return; }
    if (current !== session || !model || typeof model.estimateFaces !== 'function' || model.gazeIrises) return;
    const estimate = model.estimateFaces.bind(model);
    let failed = false;
    model.estimateFaces = async config => {
      if (failed) return estimate(config);
      try { return await estimate({ ...config, predictIrises: true }); } catch { failed = true; return estimate(config); }
    };
    model.gazeIrises = true;
  }

  function watchPicture(current) {
    const canvas = document.createElement?.('canvas'), context = canvas?.getContext?.('2d', { willReadFrequently: true });
    if (!context || typeof window.setInterval !== 'function') return null;
    [canvas.width, canvas.height] = SAMPLE_SIZE;
    let last = null, still = 0;
    const timer = window.setInterval(() => {
      if (current !== session || state !== 'ready') return;
      const id = api?.params?.videoElementId ?? 'webgazerVideoFeed';
      const video = document.getElementById?.(id);
      if (!video || video.readyState < 2) return;
      let pixels;
      try { context.drawImage(video, 0, 0, ...SAMPLE_SIZE); pixels = context.getImageData(0, 0, ...SAMPLE_SIZE).data; } catch { return; }
      const same = last !== null && last.length === pixels.length && last.every((value, i) => value === pixels[i]);
      last = Uint8ClampedArray.from(pixels);
      still = same ? still + SAMPLE_MS : 0;
      const was = frozen;
      frozen = still >= FROZEN_MS;
      if (frozen && !was) onLost('frozen');
    }, SAMPLE_MS);
    return () => window.clearInterval(timer);
  }

  async function start() {
    if (state !== 'off') return { ok: false, message: 'The camera is already on.' };
    const current = ++session;
    state = 'starting';
    const cancelled = Symbol('cancelled');
    let cancel;
    const cancellation = new Promise(resolve => { cancel = () => resolve(cancelled); });
    startup = { cancel, settled: false, retire: null };
    const mine = startup;
    try {
      const fresh = needsFresh;
      needsFresh = false;
      const loaded = await Promise.race([load({ fresh }), cancellation]);
      if (loaded === cancelled || current !== session) return { ok: false, message: 'Camera start was cancelled.' };
      api = loaded;
      identifyCamera(api, `web-${current}`);
      api.saveDataAcrossSessions(false);
      api.showPredictionPoints(false);
      api.setGazeListener(data => {
        if (current !== session || state !== 'ready' || frozen) return;
        // WebGazer calls this once a frame.
        const now = window.performance.now(), face = readFace();
        if (face?.pose) { pose = face.pose; poseAt = now; }
        if (face?.eyes) { eyes = face.eyes; eyesAt = now; }
        if (mode === 'head') {
          // Its own gaze estimate is not used.
          if (!face?.pose) { if (now - poseAt > POSE_MS) onLost(); return; }
          const point = head.predict(pose);
          if (point) onGaze(point.x, point.y, now);
          return;
        }
        const point = face?.eyes ? iris.predict(face.eyes) : null;
        if (point) {
          // Placed from a head well away from where it was calibrated, the gaze is likely off: say so with it.
          awaySince = iris.offset(face.eyes) > MOVED_SPREAD ? awaySince ?? now : null;
          if (awaySince !== null && now - awaySince >= MOVED_MS) onGaze(point.x, point.y, now, { moved: true });
          else onGaze(point.x, point.y, now);
        }
        else if (data && Number.isFinite(data.x) && Number.isFinite(data.y)) onGaze(data.x, data.y, now);
        else onLost();
      });
      const beginning = Promise.resolve(api.begin());
      const settle = () => {
        mine.settled = true;
        if (current !== session) {
          if (mine.retire) mine.retire();
          else if (loaded) releaseCamera(loaded, document);
        }
      };
      beginning.then(settle, settle);
      const began = await Promise.race([beginning, cancellation]);
      if (began === cancelled || current !== session) return { ok: false, message: 'Camera start was cancelled.' };
      api.removeMouseEventListeners();
      resetCameraCalibration(api);
      head.clear(); iris.clear(); pose = null; poseAt = -Infinity; eyes = null; eyesAt = -Infinity; lastPositions = null;
      await withIrises(current);
      if (current !== session) return { ok: false, message: 'Camera start was cancelled.' };
      state = 'ready';
      frozen = false;
      unwatch = watchPicture(current);
      return { ok: true, message: 'Camera on.' };
    } catch (error) {
      if (current === session) stop();
      return { ok: false, reason: error?.name, message: `Camera tracking could not start (${error.message}). Check camera permission, or keep using the pointer.` };
    } finally {
      if (startup === mine) startup = null;
    }
  }

  function stop() {
    const was = state;
    session++;
    state = 'off';
    unwatch?.(); unwatch = null; frozen = false;
    const pending = startup;
    pending?.cancel();
    if (api) {
      // end() cannot interrupt inference already running; never reuse this estimator instance.
      needsFresh = true;
      retireCameraModel(api);
      if (pending && !pending.settled) pending.retire = retireCamera(api, document, window);
      else releaseCamera(api, document);
    }
    api = null;
    return was !== 'off';
  }

  return {
    start,
    stop,
    get api() { return state === 'ready' ? api : null; },
    get state() { return state; },
    get mode() { return mode; },
    /** Switches between following the eyes and following the head; each needs its own calibration. */
    setMode(next) { if (next === 'eyes' || next === 'head') mode = next; },
    resetCalibration() { if (api) resetCameraCalibration(api); head.clear(); iris.clear(); awaySince = null; },
    /** Pairs the latest head pose with a screen point; false without a recent pose. */
    recordHeadSample(x, y) { return state === 'ready' && pose !== null && window.performance.now() - poseAt <= POSE_MS && head.add(pose, x, y); },
    get headSamples() { return head.samples; },
    setHeadSamples: samples => head.setSamples(samples),
    /** Pairs the latest eye pose (the irises' places) with a screen point; false without a recent one. */
    recordIrisSample(x, y) { return state === 'ready' && eyes !== null && window.performance.now() - eyesAt <= POSE_MS && iris.add(eyes, x, y); },
    get irisSamples() { return iris.samples; },
    setIrisSamples: samples => iris.setSamples(samples),
  };
}
