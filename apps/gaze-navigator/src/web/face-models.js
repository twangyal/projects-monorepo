// WebGazer loads its TensorFlow.js face models from tfhub.dev. The extension bundles those exact files
// (scripts/build-extension.js pins them by SHA-256), and the capture frame answers their addresses from the bundle.

const FACE_MODELS = {
  'tensorflow/tfjs-model/blazeface/1/default/1': 'blazeface',
  'mediapipe/tfjs-model/facemesh/1/default/1': 'facemesh',
  'mediapipe/tfjs-model/iris/1/default/2': 'iris',
};

/** The bundled file for a tfhub.dev face-model address, or null for any other address. */
export function bundledModelPath(address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'tfhub.dev') return null;
  const match = /^\/(.+)\/(model\.json|group1-shard1of1\.bin)$/.exec(url.pathname);
  const name = match && FACE_MODELS[match[1]];
  return name ? `vendor/face-models/${name}/${match[2]}` : null;
}

/**
 * A fetch that serves extension, blob and data URLs and the bundled face models, and refuses every other request,
 * so camera tracking works offline and sends nothing to a third party.
 */
export function bundledOnlyFetch(fetch, getURL) {
  return (input, init) => {
    const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input);
    if (/^(chrome-extension|blob|data):/.test(address)) return fetch(input, init);
    const bundled = bundledModelPath(address);
    if (bundled) return fetch(getURL(bundled), init);
    return Promise.reject(new TypeError(`The camera frame makes no network requests (${address.slice(0, 60)}).`));
  };
}
