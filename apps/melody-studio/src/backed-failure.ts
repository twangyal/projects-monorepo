/** Bounded native failure protocol: never forward arbitrary exception text or PCM. */
const FEEDBACK = {
  'missing-input': 'The microphone input stopped.',
  'invalid-input': 'The microphone returned invalid audio samples.',
  'changed-channels': 'The microphone channel count changed.',
  'discontinuous-frames': 'The microphone audio frames were interrupted.',
  'invalid-window': 'The recording interval could not be retained safely.',
  'invalid-command': 'The recording setup could not complete safely.',
} as const;
export type BackedFailureReason = keyof typeof FEEDBACK;

export class BackedFrameError extends Error {
  readonly reason: BackedFailureReason;
  constructor(reason: BackedFailureReason) {
    super(FEEDBACK[reason]);
    this.name = 'BackedFrameError';
    this.reason = reason;
  }
}

export function backedFailureFeedback(reason: unknown): string {
  if (typeof reason !== 'string' || !Object.hasOwn(FEEDBACK, reason)) {
    return 'The microphone capture failed. Your prior take is unchanged.';
  }
  return `${FEEDBACK[reason as BackedFailureReason]} Your prior take is unchanged. Check your microphone and try again explicitly.`;
}
