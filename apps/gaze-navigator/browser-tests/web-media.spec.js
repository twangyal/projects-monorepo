import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

// A minute of silence as a WAV file, made in the page, as the video's source: no media file is needed.
function addVideo() {
  const host = document.getElementById('gaze-web-navigator');
  for (const element of [...document.body.children]) if (element !== host) element.remove();
  const rate = 8000, samples = 60 * rate, buffer = new ArrayBuffer(44 + samples), view = new DataView(buffer);
  const text = (at, value) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); text(36, 'data'); view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128);
  const main = document.createElement('main');
  // Like many players, its buttons show only while the mouse is over it.
  main.innerHTML = `<h1>Lesson video</h1><figure id="player" style="position:relative;width:480px;height:270px;margin:40px">
    <video id="lesson" style="width:100%;height:100%;background:#123"></video>
    <div class="buttons" style="position:absolute;bottom:0;display:none"><button>Play</button></div></figure><p style="margin-top:600px">The end.</p>`;
  document.body.prepend(main);
  const video = document.getElementById('lesson');
  video.src = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  video.addTextTrack('captions', 'English', 'en');
  return new Promise(resolve => video.addEventListener('loadedmetadata', () => resolve(video.duration), { once: true }));
}

const lesson = page => page.locator('#lesson');
const property = (page, name) => lesson(page).evaluate((video, key) => video[key], name);

test('a video is played, skipped, paused, muted and sped up by voice without its hidden buttons', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  expect(await page.evaluate(addVideo)).toBeCloseTo(60, 0);
  const box = await lesson(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await say(page, 'play');
  await expect(status(page)).toContainText('Playing.');
  await expect.poll(() => property(page, 'paused')).toBe(false);
  await say(page, 'skip ahead 30 seconds');
  await expect(status(page)).toContainText(/Skipped ahead 30 seconds, to 0:3\d of 1:00\./);
  expect(await property(page, 'currentTime')).toBeGreaterThanOrEqual(30);
  await say(page, 'go back 10 seconds');
  await expect(status(page)).toContainText(/Went back 10 seconds, to 0:2\d of 1:00\./);
  await say(page, 'play at 1.5 times speed');
  await expect(status(page)).toContainText('Playing at 1.5 times speed.');
  expect(await property(page, 'playbackRate')).toBe(1.5);
  await say(page, 'mute');
  await expect(status(page)).toContainText('The video is muted.');
  expect(await property(page, 'muted')).toBe(true);
  await say(page, 'volume 40 percent');
  await expect(status(page)).toContainText('Volume 40%.');
  expect(await property(page, 'muted')).toBe(false);
  expect(await property(page, 'volume')).toBeCloseTo(0.4);
  await say(page, 'captions on');
  await expect(status(page)).toContainText('Captions on: English.');
  expect(await lesson(page).evaluate(video => video.textTracks[0].mode)).toBe('showing');
  // Looking away, the video playing is still the one meant.
  await page.mouse.move(5, 5);
  await say(page, 'pause the video');
  await expect(status(page)).toContainText(/Paused at 0:2\d of 1:00\./);
  expect(await property(page, 'paused')).toBe(true);
  await say(page, 'jump to 45 seconds');
  await expect(status(page)).toContainText('Moved to 0:45 of 1:00.');
});

test('when the browser blocks sound, the video plays without it and says so', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(addVideo);
  // As browsers do before the page has been clicked or typed in.
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { return this.muted ? play.call(this) : Promise.reject(new DOMException('Sound needs a click first.', 'NotAllowedError')); };
  });
  await page.mouse.move(5, 5);
  await say(page, 'play the video');
  await expect(status(page)).toContainText('Playing without sound');
  expect(await property(page, 'muted')).toBe(true);
  await expect.poll(() => property(page, 'paused')).toBe(false);
});

test('without a video, "play" presses the page\'s Play button as before', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    document.body.insertAdjacentHTML('afterbegin', '<main><button id="game" style="margin:80px;padding:20px">Play</button></main>');
    document.getElementById('game').addEventListener('click', () => { document.getElementById('game').textContent = 'Playing the game'; });
  });
  const box = await page.locator('#game').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await say(page, 'play');
  await expect(page.locator('#game')).toHaveText('Playing the game');
});
