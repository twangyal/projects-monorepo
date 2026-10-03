// WebGazer's public clearData() also clears shared localforage storage.
// Reset its in-memory regressions instead, leaving existing browser data alone.
export function resetCameraCalibration(api) {
  for (const regression of api.getRegression()) regression.init();
}

export function recordCalibrationClick(api, event, dot) {
  // Keyboard/synthetic activation does not establish where the eyes are looking.
  if (event.isTrusted !== true || !(event.detail > 0)) return false;
  const { left, top, width, height } = dot.getBoundingClientRect();
  const x = left + width / 2;
  const y = top + height / 2;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  const regression = api.getRegression()[0];
  const before = regression.getData().length;
  api.recordScreenPosition(x, y, 'click');
  // The dependency silently ignores training when no eye features are available.
  return regression.getData().length > before;
}
