import { AudioSync, estimatedPosition, type SyncSnapshot, type Track } from '../src/sync.ts';

const audio = document.querySelector<HTMLAudioElement>('#audio')!;
const statuses: string[] = [];
const sync = new AudioSync(audio, message => {
  statuses.push(message);
  document.querySelector('#status')!.textContent = message;
});
const tracks: Track[] = ['a', 'b'].map(letter => ({
  id: letter.repeat(32), title: `Tone ${letter}`, artist: '', duration: 10, uploadedBy: 'host', createdAt: 0,
}));
let next: SyncSnapshot | null = null;
let latest: SyncSnapshot | null = null;
let offset = 0;
function url(trackId: string): string { return `/sync-tone-${trackId[0]}.wav`; }
function snapshot(track = 'a', playing = false, position = 0, serverTime = Date.now()): SyncSnapshot {
  return { serverTime, playback: { trackId: track.repeat(32), playing, position, revision: 1 }, tracks };
}
function apply(value: SyncSnapshot, nextOffset = 0): void {
  latest = value; offset = nextOffset; sync.apply(value, url, nextOffset);
}
document.querySelector('#enable')!.addEventListener('click', () => { void sync.enable(); });
document.querySelector('#disable')!.addEventListener('click', () => sync.disable());
document.querySelector('#switch')!.addEventListener('click', () => {
  void sync.enable();
  if (next) apply(next);
});

const harness = {
  audio, sync, statuses, snapshot, apply,
  prepareSwitch(value: SyncSnapshot) { next = value; },
  drift() { return latest ? Math.abs(audio.currentTime - estimatedPosition(latest, Date.now() + offset)) : Infinity; },
};
declare global { interface Window { syncHarness: typeof harness } }
window.syncHarness = harness;
