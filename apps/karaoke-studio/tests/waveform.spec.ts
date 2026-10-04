import { type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beginDrag, detailWindow, downloadedText, expect, handleValue, holdGeometryNotifications, installGeometryGate, openWaveform, releaseGeometryNotifications, storedProject, test, waveformReady } from './waveform-fixtures.ts';

const runFile = promisify(execFile);
const undo = (page: Page) => page.getByRole('button', { name: 'Undo lyric edit', exact: true });
const redo = (page: Page) => page.getByRole('button', { name: 'Redo lyric edit', exact: true });
const save = (page: Page) => page.getByRole('button', { name: 'Save lyrics', exact: true });
const startHandle = (page: Page) => page.getByRole('slider', { name: 'Selected cue start', exact: true });

async function keyGesture(page: Page, locator: Locator, key: string, repeats = 1): Promise<void> {
  await locator.focus();
  for (let repeat = 0; repeat < repeats; repeat++) await page.keyboard.down(key);
  await page.keyboard.up(key);
}

test('actual opposite-phase waveform peaks, native seek and zoom remain separate from lyric edits', async ({ page, clips }) => {
  const project = await clips.create({ duration: 20, pulses: true });
  const waveformRequests: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'fetch' && request.url().endsWith(`/api/projects/${project.id}/audio/original`)) waveformRequests.push(request.url());
  });
  await openWaveform(page, project);
  await expect(page.getByText('Original audio waveform', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Detail window', exact: true }).selectOption('5');
  await page.getByRole('button', { name: 'Center on playhead', exact: true }).click();
  const view = await detailWindow(page);
  expect(view).toEqual({ start: 0, end: 5 });

  // Independent pixel oracle: compare actual teal waveform ink far above and
  // below the centerline for the known 1s/3s opposite-phase pulses vs silence.
  const extent = await page.locator('#waveform-detail').evaluate((element, view) => {
    const canvas = element as HTMLCanvasElement, context = canvas.getContext('2d')!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const bands = [[.3, .6], [1.02, 1.12], [2.3, 2.6], [3.02, 3.12]];
    return bands.map(([from, to]) => {
      let above = 0, below = 0;
      for (let y = Math.floor(canvas.height * .08); y < canvas.height * .92; y++) {
        if (Math.abs(y - canvas.height / 2) < canvas.height * .18) continue;
        for (let x = Math.floor((from - view.start) / (view.end - view.start) * canvas.width);
          x < (to - view.start) / (view.end - view.start) * canvas.width; x++) {
          const offset = (y * canvas.width + x) * 4;
          const [r, g, b, alpha] = data.subarray(offset, offset + 4);
          if (alpha > 100 && r < 150 && g > 80 && g > r + 20 && Math.abs(g - b) < 50) {
            if (y < canvas.height / 2) above++; else below++;
          }
        }
      }
      return { above, below };
    });
  }, view);
  for (const index of [1, 3]) {
    expect(extent[index].above).toBeGreaterThan(40); expect(extent[index].below).toBeGreaterThan(40);
  }
  for (const index of [0, 2]) {
    expect(extent[index].above).toBeLessThan(10); expect(extent[index].below).toBeLessThan(10);
  }
  const detail = await page.locator('#waveform-detail').boundingBox();
  if (!detail) throw new Error('Expected a visible detail waveform.');
  await page.mouse.click(detail.x + detail.width * .4, detail.y + detail.height / 2);
  await expect.poll(() => page.locator('#audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBeCloseTo(2, 1);
  await page.getByRole('button', { name: 'Next window', exact: true }).click();
  expect(await detailWindow(page)).toEqual({ start: 5, end: 10 });
  await page.getByRole('button', { name: 'Previous window', exact: true }).click();
  expect(await detailWindow(page)).toEqual({ start: 0, end: 5 });
  const overview = await page.locator('#waveform-overview').boundingBox();
  if (!overview) throw new Error('Expected a visible full-song overview.');
  await page.mouse.click(overview.x + overview.width * .8, overview.y + overview.height / 2);
  await expect.poll(() => page.locator('#audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBeCloseTo(16, 1);
  expect(await page.locator('#audio').evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Center on playhead', exact: true }).click();
  const centered = await detailWindow(page);
  expect(centered.start).toBeCloseTo(13.5, 1); expect(centered.end).toBeCloseTo(18.5, 1);
  await page.getByLabel('Seek in song', { exact: true }).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => page.locator('#audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBe(0);
  expect(await detailWindow(page)).toEqual(centered);
  for (const track of ['Original', 'Vocals', 'Backing']) await page.getByRole('button', { name: track, exact: true }).click();
  expect(waveformRequests).toHaveLength(1);
  await expect(save(page)).toBeDisabled(); await expect(undo(page)).toBeDisabled();
});

test('one-third precision and raw numeric spelling survive a boundary edit, undo and invalid text', async ({ page, clips, request }) => {
  const original = 1 / 3;
  const project = await clips.create({ cues: [{ start: original, end: 1.25, text: 'I' }, { start: 2, end: 2.5, text: 'WWWWWWWW' }] });
  await openWaveform(page, project);
  const untouched = page.getByLabel('End line 2', { exact: true });
  await untouched.fill('2.5000');
  const originalNode = await untouched.elementHandle();
  await page.getByLabel('Clip title', { exact: true }).fill('');
  await page.getByLabel('Lyric line 2', { exact: true }).fill('x'.repeat(241));
  await expect(save(page)).toBeDisabled();
  await startHandle(page).press('ArrowRight');
  expect(await handleValue(page, 'start')).toBe(original + .01);
  await expect(untouched).toHaveValue('2.5000');
  expect(await untouched.evaluate((node, previous) => node === previous, originalNode)).toBe(true);
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('x'.repeat(241));
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue(String(original + .01));
  await undo(page).click();
  expect(await handleValue(page, 'start')).toBe(original);
  await expect(untouched).toHaveValue('2.5000');
  await redo(page).click(); expect(await handleValue(page, 'start')).toBe(original + .01);
  expect(await storedProject(request, project.id)).toEqual(project);
});

test('held arrow repeats and pointer motion each make one undoable boundary edit', async ({ page, clips }) => {
  const project = await clips.create(); await openWaveform(page, project);
  await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
  await page.locator('#audio').evaluate(element => (element as HTMLAudioElement).play());
  await expect.poll(() => page.locator('#audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(.15);
  for (let repeat = 0; repeat < 3; repeat++) await page.keyboard.down('ArrowRight');
  // Native playback updates must not cancel an in-progress keyboard gesture.
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.5');
  await page.keyboard.up('ArrowRight');
  await page.locator('#audio').evaluate(element => (element as HTMLAudioElement).pause());
  expect(await handleValue(page, 'start')).toBeCloseTo(.54, 12);
  await undo(page).click(); expect(await handleValue(page, 'start')).toBe(.5);
  await expect(undo(page)).toBeDisabled(); await redo(page).click();
  await page.keyboard.down('Shift');
  await keyGesture(page, startHandle(page), 'ArrowRight', 2);
  await page.keyboard.up('Shift');
  expect(await handleValue(page, 'start')).toBeCloseTo(.74, 12);
  await undo(page).click(); expect(await handleValue(page, 'start')).toBeCloseTo(.54, 12);
  await beginDrag(page, 'start', .126); await page.mouse.up();
  expect(await handleValue(page, 'start')).toBeCloseTo(.67, 12);
  await undo(page).click(); expect(await handleValue(page, 'start')).toBeCloseTo(.54, 12);
  await expect(redo(page)).toBeEnabled();
  await beginDrag(page, 'start', 0); await page.mouse.up();
  await expect(redo(page)).toBeEnabled();
  await beginDrag(page, 'end', .8); await page.mouse.up();
  // Crossing the next start is rejected, never silently clamped to adjacency.
  expect(await handleValue(page, 'end')).toBe(1.5);
  await expect(redo(page)).toBeEnabled();
  await expect(page.locator('#waveform-edit-status')).not.toHaveText('');
});

test('Escape, lost capture, pointer cancellation and blur discard provisional motion without history', async ({ page, clips }) => {
  const project = await clips.create(); await openWaveform(page, project);
  await startHandle(page).press('ArrowRight'); await undo(page).click();
  for (const cancellation of ['escape', 'pointercancel', 'lostcapture', 'blur'] as const) {
    await test.step(cancellation, async () => {
      // Observe the native pointer ID for a real captured drag. Only the specific
      // cancellation signal is injected for paths without a Playwright primitive.
      await startHandle(page).evaluate(element => element.addEventListener('pointerdown', event => {
        element.setAttribute('data-observed-pointer', String((event as PointerEvent).pointerId));
      }, { once: true }));
      await beginDrag(page, 'start', .2);
      if (cancellation === 'escape') await page.keyboard.press('Escape');
      else if (cancellation === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else await startHandle(page).evaluate((element, cancellation) => {
        const pointerId = Number(element.getAttribute('data-observed-pointer'));
        if (cancellation === 'lostcapture') element.releasePointerCapture(pointerId);
        else element.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }));
      }, cancellation);
      await page.mouse.up();
      expect(await handleValue(page, 'start')).toBe(.5);
      await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeEnabled();
    });
  }
  await beginDrag(page, 'start', .2);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, height: viewport.height + 100 });
  await page.mouse.up();
  expect(await handleValue(page, 'start')).toBe(.5);
  await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeEnabled();
  await beginDrag(page, 'start', .2);
  await page.reload(); await page.mouse.up(); await waveformReady(page);
  expect(await handleValue(page, 'start')).toBe(.5);
  await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeDisabled();
});

test('geometry changes reject pointer and key releases before delayed resize notifications arrive', async ({ page, clips, request }) => {
  await installGeometryGate(page);
  const project = await clips.create(); await openWaveform(page, project);
  await startHandle(page).press('ArrowRight'); await undo(page).click();
  for (const scenario of ['pointer height', 'pointer width', 'keyboard height', 'pointer layout', 'pointer preview'] as const) {
    await test.step(scenario, async () => {
      if (scenario === 'keyboard height') {
        await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
      } else await beginDrag(page, 'start', .2);
      await holdGeometryNotifications(page);
      try {
        const viewport = page.viewportSize()!;
        if (scenario === 'pointer width') await page.setViewportSize({ ...viewport, width: viewport.width - 80 });
        else if (scenario === 'pointer layout') await page.locator('#timing-workbench').evaluate(element => { element.style.transform = 'translateY(4px)'; });
        else await page.setViewportSize({ ...viewport, height: viewport.height + 100 });
        if (scenario === 'pointer preview') {
          const box = await startHandle(page).boundingBox(); if (!box) throw new Error('Expected captured pointer handle.');
          await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
          expect(await handleValue(page, 'start')).toBe(.5);
        }
        if (scenario === 'keyboard height') await page.keyboard.up('ArrowRight'); else await page.mouse.up();
        // No wait for the product's resize listener is allowed: notifications
        // remain held here. Preview/release must itself reject stale geometry.
        expect(await handleValue(page, 'start')).toBe(.5);
        await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.5');
        await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeEnabled();
        expect(await storedProject(request, project.id)).toEqual(project);
      } finally {
        await page.locator('#timing-workbench').evaluate(element => { element.style.transform = ''; });
        await releaseGeometryNotifications(page);
      }
    });
  }
});

test('view, cue and stem changes cancel held keys; competing edits and undo keep their newer draft', async ({ page, clips }) => {
  const project = await clips.create({ duration: 20, cues: [{ start: 5.5, end: 6.5, text: 'I' }, { start: 8, end: 9, text: 'WWWWWWWW' }] });
  await openWaveform(page, project);
  const cancelWith = async (action: () => Promise<unknown>) => {
    await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
    await action(); await page.keyboard.up('ArrowRight');
  };
  await cancelWith(() => page.getByRole('combobox', { name: 'Detail window', exact: true }).selectOption('5'));
  expect(await handleValue(page, 'start')).toBe(5.5);
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('0');
  await cancelWith(() => page.getByRole('button', { name: 'Next window', exact: true }).click());
  expect(await handleValue(page, 'start')).toBe(5.5);
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('0');
  await cancelWith(() => page.getByRole('button', { name: 'Previous window', exact: true }).click());
  expect(await handleValue(page, 'start')).toBe(5.5);
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('0');
  await cancelWith(() => page.getByRole('button', { name: 'Center on playhead', exact: true }).click());
  expect(await handleValue(page, 'start')).toBe(5.5);
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('0');
  await cancelWith(() => page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('1'));
  expect(await handleValue(page, 'start')).toBe(8);
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('0');
  await cancelWith(() => page.getByRole('button', { name: 'Vocals', exact: true }).click());
  expect(await handleValue(page, 'start')).toBe(5.5);
  await expect(undo(page)).toBeDisabled();
  await cancelWith(() => page.getByLabel('Start line 1', { exact: true }).fill('5.70'));
  expect(await handleValue(page, 'start')).toBe(5.7);
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('5.70');
  await cancelWith(() => undo(page).click());
  expect(await handleValue(page, 'start')).toBe(5.5);
  await expect(redo(page)).toBeEnabled();
  await cancelWith(() => redo(page).click());
  expect(await handleValue(page, 'start')).toBe(5.7);
});

test('invalid numeric drafts disable handles while waveform updates, seeks and zoom preserve focus and text', async ({ page, clips }) => {
  const project = await clips.create();
  let release!: () => void, received!: () => void;
  const delivery = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { received = resolve; });
  await page.route(`**/api/projects/${project.id}/audio/original`, async route => {
    const response = await route.fetch(); received(); await delivery;
    await route.fulfill({ response }).catch(() => {});
  }, { times: 1 });
  try {
    await openWaveform(page, project, false); await held;
    const numeric = page.getByLabel('Start line 1', { exact: true });
    await numeric.fill(''); const node = await numeric.elementHandle();
    await expect(page.locator('#cue-start-handle')).toHaveAttribute('aria-disabled', 'true');
    await page.getByLabel('Paste lyrics, one line per cue', { exact: true }).fill('Unapplied words stay here');
    await numeric.focus(); release(); await waveformReady(page);
    await expect(numeric).toBeFocused(); await expect(numeric).toHaveValue('');
    expect(await numeric.evaluate((current, previous) => current === previous, node)).toBe(true);
    await page.getByRole('combobox', { name: 'Detail window', exact: true }).selectOption('5');
    await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('1');
    await page.getByLabel('Seek in song', { exact: true }).focus(); await page.keyboard.press('End');
    await expect.poll(() => page.locator('#audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBeCloseTo(4, 2);
    await expect(numeric).toHaveValue('');
    await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toHaveValue('Unapplied words stay here');
    await expect(save(page)).toBeDisabled();
  } finally { release(); }
});

test('stopped, failed and stale waveform work remains retryable without replacing the current draft', async ({ page, clips }) => {
  const first = await clips.create(), second = await clips.create();
  let release!: () => void, received!: () => void;
  const delivery = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { received = resolve; });
  await page.route(`**/api/projects/${first.id}/audio/original`, async route => {
    const response = await route.fetch(); received(); await delivery;
    await route.fulfill({ response }).catch(() => {});
  }, { times: 1 });
  try {
    await openWaveform(page, first, false); await held;
    await page.getByLabel('Lyric line 1', { exact: true }).fill('Keep edited words');
    await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
    await page.getByRole('button', { name: 'Stop waveform', exact: true }).click();
    await page.keyboard.up('ArrowRight');
    expect(await handleValue(page, 'start')).toBe(.5);
    await expect(page.getByRole('button', { name: 'Retry waveform', exact: true })).toBeVisible();
    release();
    await page.unroute(`**/api/projects/${first.id}/audio/original`);
    await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Keep edited words');
    await page.route(`**/api/projects/${first.id}/audio/original`, route => route.fulfill({ status: 503, body: 'Failure body must not become a waveform error.' }), { times: 1 });
    await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
    await page.getByRole('button', { name: 'Retry waveform', exact: true }).click();
    await page.keyboard.up('ArrowRight');
    expect(await handleValue(page, 'start')).toBe(.5);
    await expect(page.locator('#waveform-status')).toContainText(/could not|failed|unavailable|retry/i);
    await expect(page.locator('#waveform-status')).not.toContainText('Failure body');
    await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Keep edited words');
    await page.getByRole('button', { name: 'Retry waveform', exact: true }).click(); await waveformReady(page);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(second.id);
    await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue(second.title);
    await waveformReady(page);
    await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(second.cues[0].text);
  } finally { release(); }
});

test('save initiation and successful project replacement discard held boundary motion', async ({ page, clips, request }) => {
  const first = await clips.create(), second = await clips.create({ cues: [{ start: 1, end: 2, text: 'Replacement cue' }] });
  await openWaveform(page, first);
  await page.getByLabel('Clip title', { exact: true }).fill('Saved title while gesture cancelled');
  await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
  await save(page).click(); await page.keyboard.up('ArrowRight');
  await expect(page.locator('#message')).toContainText('saved locally');
  expect((await storedProject(request, first.id)).cues).toEqual(first.cues);
  await expect(undo(page)).toBeDisabled();
  await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
  await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(second.id);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Replacement cue');
  await page.keyboard.up('ArrowRight'); await waveformReady(page);
  expect(await handleValue(page, 'start')).toBe(1);
  await expect(undo(page)).toBeDisabled();
  await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
  await page.keyboard.up('ArrowRight');
  await expect(page.getByLabel('Clip title', { exact: true })).toBeHidden();
  expect((await request.get(`/api/projects/${second.id}`)).status()).toBe(404);
  expect((await storedProject(request, first.id)).cues).toEqual(first.cues);
});

test('late original-audio work cannot replace a newer project, and a failed open keeps completed peaks', async ({ page, clips }) => {
  const first = await clips.create({ duration: 8 }), second = await clips.create({ duration: 4 });
  let release!: () => void, received!: () => void;
  const delivery = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { received = resolve; });
  await page.route(`**/api/projects/${first.id}/audio/original`, async route => {
    const response = await route.fetch(); received(); await delivery;
    await route.fulfill({ response }).catch(() => {});
  }, { times: 1 });
  try {
    await openWaveform(page, first, false); await held;
    await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(second.id);
    await expect(page.locator('#audio')).toHaveAttribute('src', new RegExp(second.id));
    await waveformReady(page); release();
    await expect(page.getByLabel('Seek in song', { exact: true })).toHaveAttribute('max', '4');
    expect(await detailWindow(page)).toEqual({ start: 0, end: 4 });
    const before = await page.locator('#waveform-overview').evaluate(element => (element as HTMLCanvasElement).toDataURL());
    await page.getByLabel('Start line 1', { exact: true }).fill('.5000');
    await page.getByLabel('Lyric line 1', { exact: true }).fill('Keep draft after failed navigation');
    await page.route(`**/api/projects/${first.id}`, route => route.fulfill({ status: 503, json: { error: 'Controlled project open failure.' } }), { times: 1 });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('combobox', { name: 'Saved clips', exact: true }).selectOption(first.id);
    await expect(page.locator('#message')).toContainText('Controlled project open failure');
    await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('.5000');
    await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Keep draft after failed navigation');
    await waveformReady(page);
    expect(await page.locator('#waveform-overview').evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(before);
  } finally { release(); }
});

test('the owning waveform deadline stops stalled delivery without disabling timing correction', async ({ page, clips }) => {
  const project = await clips.create();
  let release!: () => void, received!: () => void;
  const delivery = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { received = resolve; });
  await page.route(`**/api/projects/${project.id}/audio/original`, async route => {
    const response = await route.fetch(); received(); await delivery;
    await route.fulfill({ response }).catch(() => {});
  }, { times: 1 });
  try {
    // Advance only the main controller clock. This tests its real 30s deadline
    // while an actual worker/network response remains pending, without a wait.
    await page.clock.install(); await openWaveform(page, project, false); await held;
    await page.clock.fastForward(30001);
    await expect(page.locator('#waveform-status')).toContainText(/30 seconds|time limit|deadline/i);
    await expect(page.getByRole('button', { name: 'Retry waveform', exact: true })).toBeVisible();
    release(); await startHandle(page).press('ArrowRight');
    expect(await handleValue(page, 'start')).toBe(.51);
    await expect(save(page)).toBeEnabled();
  } finally { release(); }
});

test('fresh keys after blur work and controlled persisted lifecycle retains the waveform and raw draft', async ({ page, clips }) => {
  const project = await clips.create(); await openWaveform(page, project);
  await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.down('ArrowRight');
  expect(await handleValue(page, 'start')).toBe(.5);
  await page.keyboard.up('ArrowRight');
  await startHandle(page).press('ArrowRight');
  expect(await handleValue(page, 'start')).toBe(.51);
  await undo(page).click(); expect(await handleValue(page, 'start')).toBe(.5);
  await page.getByLabel('Clip title', { exact: true }).fill('Retain this unsaved title');
  const numeric = page.getByLabel('Start line 1', { exact: true });
  await numeric.fill('.5000'); const node = await numeric.elementHandle();
  await page.getByLabel('Paste lyrics, one line per cue', { exact: true }).fill('Retain these unapplied words');
  const before = await page.locator('#waveform-overview').evaluate(element => (element as HTMLCanvasElement).toDataURL());
  await startHandle(page).focus(); await page.keyboard.down('ArrowRight');
  // Deterministic event coverage, not a claim that Chromium admitted this
  // no-store page to native BFCache. The real lifecycle callbacks are exercised.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.keyboard.up('ArrowRight');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  expect(await handleValue(page, 'start')).toBe(.5);
  await waveformReady(page);
  await expect(page.getByLabel('Clip title', { exact: true })).toHaveValue('Retain this unsaved title');
  await expect(numeric).toHaveValue('.5000');
  expect(await numeric.evaluate((current, previous) => current === previous, node)).toBe(true);
  await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toHaveValue('Retain these unapplied words');
  expect(await page.locator('#waveform-overview').evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(before);
  await expect(save(page)).toBeDisabled();
  await startHandle(page).press('ArrowRight'); expect(await handleValue(page, 'start')).toBe(.51);
});

test('saved waveform edits produce exact SRT and real MP4 half-open boundaries', async ({ page, clips, request }) => {
  test.setTimeout(60000);
  const project = await clips.create({ cues: [
    { start: .323, end: 1, text: 'I' }, { start: 1, end: 1.4, text: 'WWWWWWWW' }, { start: 2.1, end: 3, text: 'I' },
  ] });
  await openWaveform(page, project);
  await startHandle(page).press('ArrowRight');
  expect(await handleValue(page, 'start')).toBe(.333);
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('2');
  await page.getByRole('slider', { name: 'Selected cue end', exact: true }).press('ArrowLeft');
  expect(await handleValue(page, 'end')).toBe(2.99);
  await save(page).click(); await expect(page.locator('#message')).toContainText('saved locally');
  const saved = await storedProject(request, project.id);
  expect(saved.cues).toEqual([{ start: .333, end: 1, text: 'I' }, { start: 1, end: 1.4, text: 'WWWWWWWW' }, { start: 2.1, end: 2.99, text: 'I' }]);
  expect(await downloadedText(page, 'Export timed lyrics')).toBe(
    '1\n00:00:00,333 --> 00:00:01,000\nI\n\n2\n00:00:01,000 --> 00:00:01,400\nWWWWWWWW\n\n3\n00:00:02,100 --> 00:00:02,990\nI\n');
  const videoDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click();
  const videoPath = await (await videoDownload).path(); if (!videoPath) throw new Error('Expected downloaded MP4.');
  const metadata = JSON.parse((await runFile('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', videoPath], { timeout: 15000 })).stdout) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_read_frames?: string; r_frame_rate?: string }[];
  };
  expect(metadata.streams.find(stream => stream.codec_type === 'video')).toMatchObject({ codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '24/1', nb_read_frames: '96' });
  expect(metadata.streams.find(stream => stream.codec_type === 'audio')?.codec_name).toBe('aac');
  const frames = [7, 8, 23, 24, 33, 34, 50, 51, 71, 72, 95];
  const selection = frames.map(frame => `eq(n\\,${frame})`).join('+');
  const decoded = await runFile('ffmpeg', ['-v', 'error', '-threads', '1', '-i', videoPath, '-vf', `select=${selection}`,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-threads', '1', 'pipe:1'],
  { encoding: 'buffer', timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  const frameBytes = 1280 * 720 * 3; expect(decoded.stdout.length).toBe(frames.length * frameBytes);
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index], cue = saved.cues.find(item => item.start <= frame / 24 && frame / 24 < item.end);
    let warm = 0, minX = 1280, maxX = 0;
    for (let y = 200; y < 440; y++) for (let x = 100; x < 1180; x++) {
      const offset = index * frameBytes + (y * 1280 + x) * 3;
      const [r, g, b] = decoded.stdout.subarray(offset, offset + 3);
      if (r > 160 && g > 110 && b < 175 && r > g + 15 && g > b + 20) { warm++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    if (!cue) expect(warm, `gap at saved frame ${frame}`).toBeLessThan(20);
    else {
      expect(warm, `active cue at saved frame ${frame}`).toBeGreaterThan(40);
      // Distinct original glyph widths identify the active cue at adjacency,
      // independently of production render_card or shared preview helpers.
      if (cue.text === 'I') expect(maxX - minX).toBeLessThan(40);
      else expect(maxX - minX).toBeGreaterThan(200);
    }
  }
  await page.reload(); await openWaveform(page, saved);
  expect(await handleValue(page, 'start')).toBe(.333);
  await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeDisabled();
});

test('200 cue labels and touch-sized timing lanes remain bounded on mobile', async ({ page, clips }) => {
  const project = await clips.create({ duration: 20, cues: Array.from({ length: 200 }, (_, index) => ({ start: index / 10, end: (index + 1) / 10, text: `Line ${index + 1}` })) });
  await page.setViewportSize({ width: 390, height: 844 }); await openWaveform(page, project);
  await page.getByRole('combobox', { name: 'Detail window', exact: true }).selectOption('5');
  for (const [cue, boundary, initial, delta] of [['0', 'start', 0, .06], ['199', 'end', 20, -.04]] as const) {
    await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption(cue);
    const handle = page.locator(`#cue-${boundary}-handle`);
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox(); if (!box) throw new Error('Expected an endpoint handle.');
    const visibility = await handle.evaluate(element => {
      const rect = element.getBoundingClientRect(), lane = element.parentElement!.getBoundingClientRect();
      return {
        contained: rect.left >= lane.left - .5 && rect.right <= lane.right + .5 && rect.top >= lane.top && rect.bottom <= lane.bottom,
        reachable: [.1, .9].map(fraction => {
          const hit = document.elementFromPoint(rect.left + rect.width * fraction, rect.top + rect.height / 2);
          return hit === element || element.contains(hit);
        }),
      };
    });
    expect(visibility).toEqual({ contained: true, reachable: [true, true] });
    const canvas = await page.locator('#waveform-detail').boundingBox(), view = await detailWindow(page);
    if (!canvas) throw new Error('Expected an endpoint detail window.');
    // Begin from the outer tenth of the endpoint target, which a clipped half
    // handle would make unreachable, then perform an actual native drag.
    const x = box.x + box.width * (boundary === 'start' ? .1 : .9), y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + delta * canvas.width / (view.end - view.start), y, { steps: 4 });
    await page.mouse.up();
    expect(await handleValue(page, boundary)).toBeCloseTo(initial + delta, 12);
    await undo(page).click(); expect(await handleValue(page, boundary)).toBe(initial);
  }
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('199');
  expect(await handleValue(page, 'end')).toBe(20);
  for (const id of ['#cue-start-handle', '#cue-end-handle']) {
    const box = await page.locator(id).boundingBox(); if (!box) throw new Error('Expected selected timing handle.');
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const detail = page.locator('#waveform-detail');
  expect(await detail.evaluate(element => (element as HTMLCanvasElement).width * (element as HTMLCanvasElement).height)).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('slider', { name: 'Selected cue end', exact: true }).press('ArrowRight');
  expect(await handleValue(page, 'end')).toBe(20); await expect(undo(page)).toBeDisabled();
  await page.getByLabel('Lyric line 200', { exact: true }).fill('x'.repeat(1000000));
  await page.getByRole('combobox', { name: 'Selected lyric cue', exact: true }).selectOption('0');
  expect((await page.locator('#waveform-cue').textContent())!.length).toBeLessThan(20000);
  await expect(page.getByLabel('Lyric line 200', { exact: true })).toHaveValue('x'.repeat(1000000));
});
