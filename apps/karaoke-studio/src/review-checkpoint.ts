import type { ReviewedCue } from './automatic-review.ts';
import { MAX_CUES } from './lyrics.ts';

export const MAX_REVIEW_CHECKPOINT_BYTES = 1024 * 1024;
const unreadable = () => new Error('Use a valid review checkpoint of at most 1 MiB. Current drafts are unchanged.');
/** Bound to this clip and exact original reading, including its word timings and confidence. */
export async function reviewCheckpointBinding(projectId: string, duration: number, source: string, original: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([projectId, duration, source, original]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable();
  return value as Record<string, unknown>;
}
/** Raw invalid drafts are useful checkpoints too; applying lyrics still uses the normal cue validator. */
export function readReviewCheckpoint(text: string, binding: string, count: number): { draft: ReviewedCue[]; checked: number[] } {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_REVIEW_CHECKPOINT_BYTES) throw unreadable();
  let value: Record<string, unknown>;
  try { value = record(JSON.parse(text)); } catch { throw unreadable(); }
  if (Object.keys(value).sort().join() !== 'binding,checked,draft,kind,version' || value.kind !== 'karaoke-review-checkpoint' || value.version !== 1
    || typeof value.binding !== 'string' || !/^[a-f0-9]{64}$/.test(value.binding)) throw unreadable();
  if (value.binding !== binding) throw new Error('Open the matching clip and original recognition review before restoring this checkpoint. Current drafts are unchanged.');
  if (!Array.isArray(value.draft) || value.draft.length !== count || count < 1 || count > MAX_CUES || !Array.isArray(value.checked) || value.checked.length > count) throw unreadable();
  const draft = value.draft.map(raw => {
    const row = record(raw), keys = Object.keys(row).sort().join();
    if (keys !== 'end,start,text' && keys !== 'end,excluded,start,text') throw unreadable();
    if (typeof row.start !== 'string' || row.start.length > 64 || typeof row.end !== 'string' || row.end.length > 64
      || typeof row.text !== 'string' || row.text.length > 2048 || 'excluded' in row && typeof row.excluded !== 'boolean') throw unreadable();
    return { start: row.start, end: row.end, text: row.text, ...('excluded' in row ? {excluded:row.excluded as boolean} : {}) };
  });
  const checked: number[] = [];
  for (const index of value.checked) {
    if (!Number.isInteger(index) || index < 0 || index >= count || checked.includes(index)) throw unreadable();
    checked.push(index);
  }
  return {draft,checked};
}
export function serializeReviewCheckpoint(binding: string, draft: readonly ReviewedCue[], checked: readonly number[]): string {
  const text = JSON.stringify({kind:'karaoke-review-checkpoint',version:1,binding,draft,checked});
  readReviewCheckpoint(text,binding,draft.length);
  return text;
}
