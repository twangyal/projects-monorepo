// Test-only stand-in for the bundled WebGazer estimator, injected like the real file.
(() => {
  const record = globalThis.__fakeCamera ??= { instances: 0, released: 0, faceVisible: true };
  let listener = null;
  let samples = [];
  record.instances++;
  globalThis.webgazer = {
    params: {},
    setGazeListener(callback) { listener = callback; return this; },
    clearGazeListener() { listener = null; return this; },
    begin: async () => globalThis.webgazer,
    saveDataAcrossSessions() { return this; },
    showPredictionPoints() { return this; },
    removeMouseEventListeners() { return this; },
    end() { record.released++; return this; },
    stopVideo() { return this; },
    getRegression: () => [{
      init() { samples = []; },
      getData: () => samples,
      setData(data) { record.restored = (record.restored ?? 0) + data.length; samples.push(...data); },
    }],
    // Samples mimic WebGazer's: tiny RGBA eye patches plus the trained screen position.
    recordScreenPosition(x, y, type) {
      if (!record.faceVisible) return;
      const eye = () => ({ width: 2, height: 1, imagex: 0, imagey: 0, patch: { data: new Uint8ClampedArray(8).fill(samples.length % 256) } });
      samples.push({ eyes: { left: eye(), right: eye() }, screenPos: [x, y], type });
    },
    emit(point) { listener?.(point, 0); },
  };
})();
