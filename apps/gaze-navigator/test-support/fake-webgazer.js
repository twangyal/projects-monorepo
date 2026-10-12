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
    getRegression: () => [{ init() { samples = []; }, getData: () => samples }],
    recordScreenPosition(x, y) { if (record.faceVisible) samples.push([x, y]); },
    emit(point) { listener?.(point, 0); },
  };
})();
