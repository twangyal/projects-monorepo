import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { chooseMedia, controlMedia } from '../src/web/page-actions.js';
import { spokenDuration } from '../src/web/spoken-values.js';

const video = (extra = {}) => ({ kind: 'video', distance: Infinity, playing: false, onScreen: true, ...extra });
const withVideo = { elements: [], media: () => [video({ distance: 0, playing: true })] };
const nothing = { elements: [] };
const said = (text, context = withVideo) => {
  const action = interpret(text, context);
  return action.type === 'media' ? { change: action.change, ...('by' in action ? { by: action.by } : {}), ...('to' in action ? { to: action.to } : {}), ...('on' in action ? { on: action.on } : {}) } : action.type;
};

test('lengths of time are read as said', () => {
  assert.equal(spokenDuration('ten seconds'), 10);
  assert.equal(spokenDuration('a minute and a half'), 90);
  assert.equal(spokenDuration('1 minute 30'), 90);
  assert.equal(spokenDuration('one and a half minutes'), 90);
  assert.equal(spokenDuration('half an hour'), 1800);
  assert.equal(spokenDuration('1:30'), 90);
  assert.equal(spokenDuration('1:02:03'), 3723);
  // A bare number could be seconds or minutes.
  assert.equal(spokenDuration('thirty'), null);
});

test('video commands are read from speech, and bare words only when the page has a video', () => {
  assert.deepEqual(said('pause the video'), { change: 'pause' });
  assert.deepEqual(said('play'), { change: 'play' });
  assert.deepEqual(said('mute'), { change: 'mute' });
  assert.deepEqual(said('skip ahead 30 seconds'), { change: 'skip', by: 30 });
  assert.deepEqual(said('rewind'), { change: 'skip', by: -10 });
  assert.deepEqual(said('go back 10 seconds'), { change: 'skip', by: -10 });
  assert.deepEqual(said('jump to 1:30'), { change: 'seek', to: 90 });
  assert.deepEqual(said('volume 50 percent'), { change: 'volume', to: 0.5 });
  assert.deepEqual(said('turn it down a lot'), { change: 'volume', by: -0.3 });
  assert.deepEqual(said('play at 1.5 times speed'), { change: 'speed', to: 1.5 });
  assert.deepEqual(said('slow down'), { change: 'speed', by: -0.25 });
  assert.deepEqual(said('captions on'), { change: 'captions', on: true });
  assert.deepEqual(said('play it again'), { change: 'restart' });
  // Without a video, bare words are not video commands, and "it" is not a video.
  for (const text of ['play', 'mute', 'rewind', 'skip ahead', 'pause it']) assert.notEqual(interpret(text, nothing).type, 'media');
  assert.deepEqual(said('pause the video', nothing), { change: 'pause' });
  // The navigator's own words keep their meaning.
  assert.equal(said('pause'), 'pause');
  assert.equal(said('stop'), 'cancel');
  assert.equal(said('go back'), 'back');
  assert.equal(said('go forward'), 'forward');
  assert.equal(said('resume'), 'resume');
  // A control near the gaze named like the word is pressed instead: a game's Play button, a call's Mute button.
  const buttons = { ...withVideo, elements: [{ id: 1, name: 'Play', role: 'button', distance: 0 }, { id: 2, name: 'Mute', role: 'button', distance: 4 }] };
  assert.equal(said('play', buttons), 'activate');
  assert.equal(said('mute', buttons), 'activate');
  assert.equal(said('skip ad', withVideo), 'unknown');
  // A Volume slider near the gaze is set as a slider; other video commands still reach the video.
  const slider = { ...withVideo, elements: [{ id: 1, name: 'Volume', role: 'slider', distance: 0 }] };
  assert.equal(said('set volume to seventy', slider), 'range');
  assert.deepEqual(said('skip ahead', slider), { change: 'skip', by: 10 });
});

test('the video meant is the one looked at, else the one playing, else the only one', () => {
  const near = video({ distance: 0 }), playing = video({ playing: true }), other = video();
  assert.deepEqual(chooseMedia([near, playing], { radius: 40 }).targets, [near]);
  assert.deepEqual(chooseMedia([playing, other], { radius: 40 }).targets, [playing]);
  assert.equal(chooseMedia([video(), video()], { radius: 40 }).ambiguous.length, 2);
  // Several playing: all are paused, but skipping needs the one meant.
  const both = [video({ playing: true }), video({ playing: true })];
  assert.equal(chooseMedia(both, { change: 'pause' }).targets.length, 2);
  assert.equal(chooseMedia(both, { change: 'skip' }).ambiguous.length, 2);
  // A hidden player, as music sites use, counts when it is the only one.
  const hidden = video({ kind: 'audio', onScreen: false });
  assert.deepEqual(chooseMedia([hidden]).targets, [hidden]);
  assert.ok(chooseMedia([]).none);
});

function fakeMedia(extra = {}) {
  return { paused: false, ended: false, muted: false, volume: 1, currentTime: 65, duration: 300, playbackRate: 1, textTracks: [],
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, ...extra };
}

test('media changes are done and described', async () => {
  const media = fakeMedia(), targets = [{ element: media, kind: 'video' }];
  assert.equal(controlMedia(targets, { change: 'skip', by: 30 }).message, 'Skipped ahead 30 seconds, to 1:35 of 5:00.');
  assert.equal(media.currentTime, 95);
  assert.equal(controlMedia(targets, { change: 'skip', by: -120 }).message, 'Went back 2 minutes, to 0:00 of 5:00.');
  assert.equal(controlMedia(targets, { change: 'seek', to: 600 }).ok, false);
  assert.equal(controlMedia(targets, { change: 'volume', by: -0.1 }).message, 'Volume 90%.');
  assert.equal(controlMedia(targets, { change: 'speed', by: 0.25 }).message, 'Playing at 1.25 times speed.');
  assert.equal(controlMedia(targets, { change: 'mute' }).message, 'The video is muted. Say unmute to hear it again.');
  assert.match(controlMedia(targets, { change: 'unmute' }).message, /^Sound on, at 90% volume\.$/);
  assert.equal(controlMedia(targets, { change: 'pause' }).message, 'Paused at 0:00 of 5:00.');
  assert.equal((await controlMedia(targets, { change: 'play' })).message, 'Playing.');
  assert.equal(controlMedia(targets, { change: 'captions', on: true }).ok, false);
  assert.equal(controlMedia([{ element: fakeMedia({ duration: Infinity }), kind: 'video' }], { change: 'skip', by: 10 }).message, 'This video is live, so it cannot skip.');
});

test('when the browser blocks sound, the video plays muted and says why', async () => {
  const blocked = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  const media = fakeMedia({ paused: true, play() { if (!this.muted) return Promise.reject(blocked); this.paused = false; return Promise.resolve(); } });
  const result = await controlMedia([{ element: media, kind: 'video' }], { change: 'play' });
  assert.ok(result.ok);
  assert.match(result.message, /^Playing from 1:05 without sound/);
  assert.equal(media.muted, true);
});

test('video commands need no gaze, start later, repeat with again and wait while paused', async () => {
  const done = [];
  const controller = createController({ window: {}, interpret, commands: {
    media: action => { done.push(action.change); return action.change === 'play' ? Promise.resolve({ ok: true, message: 'Playing.' }) : { ok: true, message: `Did ${action.change}.` }; },
  } });
  assert.equal(controller.handle('skip ahead 30 seconds', { ...withVideo, trackingUnavailable: true }).message, 'Did skip.');
  assert.equal(controller.handle('again', withVideo).message, 'Did skip.');
  const playing = controller.handle('play', withVideo);
  assert.equal(playing.message, 'Starting…');
  assert.equal((await playing.followUp).message, 'Playing.');
  assert.match(controller.handle('pause', withVideo).message, /A video is still playing/);
  assert.match(controller.handle('mute', withVideo).message, /^Paused/);
  assert.deepEqual(done, ['skip', 'skip', 'play']);
});
