import { parseTranscript, type Transcript } from './auto-lyrics.ts';

export type RecognitionPassage = { available: false } | {
  available: true; candidateId: string; start: number; end: number;
  candidate: Extract<Transcript, { available: true }>;
};

export function recognitionRange(startText: string, endText: string, duration: number): { start: number; end: number } {
  const start = Number(startText), end = Number(endText);
  if (!startText.trim() || !endText.trim() || !Number.isFinite(start) || !Number.isFinite(end)
      || !(start >= 0 && end <= duration && end - start >= 1 && end - start <= 60)) {
    throw new Error('Choose a passage of 1–60 seconds inside this clip.');
  }
  return { start, end };
}

export function parseRecognitionPassage(value: unknown, duration: number): RecognitionPassage {
  const problem = () => new Error('The studio returned an unreadable passage preview.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem();
  const reply = value as Record<string, unknown>;
  if (reply.available === false && Object.keys(reply).length === 1) return { available: false };
  if (reply.available !== true || Object.keys(reply).sort().join(',') !== 'available,candidate,candidateId,end,start'
      || typeof reply.candidateId !== 'string' || !/^[0-9a-f]{64}$/.test(reply.candidateId)
      || typeof reply.start !== 'number' || typeof reply.end !== 'number') throw problem();
  const { start, end } = recognitionRange(String(reply.start), String(reply.end), duration);
  const candidate = parseTranscript(reply.candidate, duration);
  if (!candidate.available || candidate.cues.some(cue => cue.start < start || cue.end > end
      || cue.words.some(word => word.start < start || word.end > end))) throw problem();
  return { available: true, candidateId: reply.candidateId, start, end, candidate };
}
