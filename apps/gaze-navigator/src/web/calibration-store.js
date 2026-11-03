// Serializes WebGazer ridge-regression training samples so a calibration can follow the user
// between pages. Eye patches are tiny RGBA images; they are base64-encoded for JSON storage.

export const CALIBRATION_VERSION = 1;
export const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function toBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeEye(eye) {
  const { patch, ...rest } = eye;
  const data = patch?.data;
  if (!data || !Number.isInteger(eye.width) || !Number.isInteger(eye.height) || data.length !== eye.width * eye.height * 4) return null;
  return { ...rest, patch: toBase64(new Uint8Array(data.buffer, data.byteOffset, data.length)) };
}

export function encodeCalibration(samples, { width, height, now }) {
  const encoded = [];
  for (const sample of samples ?? []) {
    const left = sample?.eyes?.left && encodeEye(sample.eyes.left);
    const right = sample?.eyes?.right && encodeEye(sample.eyes.right);
    if (!left || !right || !Array.isArray(sample.screenPos)) continue;
    encoded.push({ eyes: { left, right }, screenPos: [...sample.screenPos], type: sample.type });
  }
  return { version: CALIBRATION_VERSION, width, height, savedAt: now, samples: encoded };
}

/** A head pointer's calibration (head-pointer.js samples: pose and screen point), stored like an eye calibration. */
export function encodeHeadCalibration(samples, { width, height, now }) {
  const valid = (samples ?? []).filter(s => Array.isArray(s?.features) && s.features.every(Number.isFinite) && Number.isFinite(s.x) && Number.isFinite(s.y));
  return { version: CALIBRATION_VERSION, mode: 'head', width, height, savedAt: now, samples: valid.map(({ features, x, y }) => ({ features: [...features], x, y })) };
}

// Returns samples in the shape WebGazer's setData() expects (or, for `mode` 'head', head pointer samples), or a reason
// the calibration cannot be reused. A calibration made for the other mode is not reused.
export function decodeCalibration(stored, { width, height, now, mode = 'eyes' }) {
  if (!stored || stored.version !== CALIBRATION_VERSION || !Array.isArray(stored.samples) || !stored.samples.length) {
    return { ok: false, reason: 'none' };
  }
  if ((stored.mode ?? 'eyes') !== mode) return { ok: false, reason: 'mode' };
  if (stored.width !== width || stored.height !== height) return { ok: false, reason: 'resized' };
  if (!(now - stored.savedAt >= 0 && now - stored.savedAt <= MAX_AGE_MS)) return { ok: false, reason: 'expired' };
  if (mode === 'head') {
    const samples = stored.samples.filter(s => Array.isArray(s?.features) && s.features.length === 4 && s.features.every(Number.isFinite) && Number.isFinite(s.x) && Number.isFinite(s.y));
    return samples.length === stored.samples.length ? { ok: true, samples: samples.map(({ features, x, y }) => ({ features: [...features], x, y })) } : { ok: false, reason: 'invalid' };
  }
  try {
    const samples = stored.samples.map(sample => ({
      eyes: {
        left: { ...sample.eyes.left, patch: { data: fromBase64(sample.eyes.left.patch) } },
        right: { ...sample.eyes.right, patch: { data: fromBase64(sample.eyes.right.patch) } },
      },
      screenPos: [...sample.screenPos],
      type: sample.type,
    }));
    return { ok: true, samples };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
