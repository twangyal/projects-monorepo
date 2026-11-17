/** The pinned MediaPipe pose landmarker model (Apache-2.0) and its checked download. */
export const POSE_MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  bytes: 5777746,
  sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
} as const;

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

/** The pinned model's bytes, refused unless they are exactly the pinned file. */
export async function fetchPoseModel(fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const reply = await fetcher(POSE_MODEL.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!reply.ok) throw new Error(`The pose model could not be downloaded (${reply.status}).`);
  const bytes = await reply.arrayBuffer();
  if (bytes.byteLength !== POSE_MODEL.bytes || hex(await crypto.subtle.digest('SHA-256', bytes)) !== POSE_MODEL.sha256) {
    throw new Error('The downloaded pose model is not the expected file, so it was not used.');
  }
  return new Uint8Array(bytes);
}
