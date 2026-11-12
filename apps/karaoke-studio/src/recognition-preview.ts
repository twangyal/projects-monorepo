import { parseTranscript, type Transcript } from './auto-lyrics.ts';

export type RecognitionPreview = { available: false } | {
  available: true; candidateId: string; referenceId: string | null; current: Transcript;
  candidate: Extract<Transcript, { available: true }>;
};

export function parseRecognitionPreview(value: unknown, duration: number): RecognitionPreview {
  const problem = () => new Error('The studio returned an unreadable recognition comparison.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem();
  const reply = value as Record<string, unknown>;
  if (reply.available === false && Object.keys(reply).length === 1) return { available: false };
  const digest = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);
  if (reply.available !== true || Object.keys(reply).sort().join(',') !== 'available,candidate,candidateId,current,referenceId'
      || !digest(reply.candidateId) || (reply.referenceId !== null && !digest(reply.referenceId))) throw problem();
  const current = parseTranscript(reply.current, duration), candidate = parseTranscript(reply.candidate, duration);
  if (!candidate.available || current.available !== (reply.referenceId !== null)) throw problem();
  return { available: true, candidateId: reply.candidateId, referenceId: reply.referenceId as string | null, current, candidate };
}
