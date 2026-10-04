import { test, expect, type Page } from '@playwright/test';
import { savedProject } from './browser/continuation-fixtures.ts';

interface RecordingFixture {
  stream: MediaStream | null;
  stopped: number;
  requests: number;
  elapsedSeconds: () => number;
  resolvePermission: () => void;
  stopInput: () => void;
}

type RecordingWindow = Window & { __melodyRecording: RecordingFixture };

async function installSyntheticMicrophone(page: Page, pending = false): Promise<void> {
  await page.addInitScript(({ pending }) => {
    let context: AudioContext | null = null;
    let resolvePermission: (() => void) | null = null;
    const fixture: RecordingFixture = {
      stream: null,
      stopped: 0,
      requests: 0,
      elapsedSeconds: () => context?.currentTime ?? 0,
      resolvePermission: () => {
        if (!resolvePermission) throw new Error('No microphone permission request is pending.');
        resolvePermission();
        resolvePermission = null;
      },
      stopInput: () => {
        if (!fixture.stream) throw new Error('No microphone stream exists.');
        for (const track of fixture.stream.getTracks()) track.stop();
      },
    };
    (window as unknown as RecordingWindow).__melodyRecording = fixture;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        fixture.requests += 1;
        context = new AudioContext();
        const audioContext = context;
        const oscillator = audioContext.createOscillator();
        oscillator.frequency.value = 440;
        const volume = audioContext.createGain();
        volume.gain.value = 0.3;
        const destination = audioContext.createMediaStreamDestination();
        oscillator.connect(volume).connect(destination);
        oscillator.start();
        const stream = destination.stream;
        fixture.stream = stream;
        for (const track of stream.getTracks()) {
          const originalStop = track.stop.bind(track);
          track.stop = () => {
            if (track.readyState === 'ended') return;
            fixture.stopped += 1;
            originalStop();
            oscillator.stop();
            void audioContext.close().catch(() => {});
          };
        }
        await audioContext.resume();
        if (!pending) return stream;
        return new Promise<MediaStream>(resolve => { resolvePermission = () => resolve(stream); });
      },
    });
  }, { pending });
}

async function awaitCapturedTone(page: Page): Promise<void> {
  // Let the real audio graph generate enough frames for a stable pitched note.
  await expect.poll(() => page.evaluate(() => {
    return (window as unknown as RecordingWindow).__melodyRecording.elapsedSeconds();
  })).toBeGreaterThan(1);
}

async function expectReleasedStream(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const fixture = (window as unknown as RecordingWindow).__melodyRecording;
    return fixture.stopped > 0 && fixture.stream?.getTracks().every(track => track.readyState === 'ended');
  })).toBe(true);
}

test('Finish records a real synthetic microphone, decodes A4 and releases the stream', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installSyntheticMicrophone(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Record melody', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish recording', exact: true })).toBeVisible();
  await awaitCapturedTone(page);
  await page.getByRole('button', { name: 'Finish recording', exact: true }).click();
  await expectReleasedStream(page);
  await expect(page.getByRole('status')).toContainText('Detected', { timeout: 20000 });
  await expect(page.getByLabel('Pitch (MIDI)')).toHaveValue('69');
  await expect(page.locator('.note-event')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record melody', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('cancelling pending permission releases its late stream and preserves existing notes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { void dialog.accept(); });
  await installSyntheticMicrophone(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example', exact: true }).click();
  const priorNotes = await page.locator('.note-event').evaluateAll(notes => notes.map(note => note.getAttribute('aria-label')));
  const priorSavedProject = await savedProject(page);
  expect(priorSavedProject.tracks.some(track => track.notes.length > 0)).toBe(true);
  await page.getByRole('button', { name: 'Record melody', exact: true }).click();
  await expect(page.locator('#capture-state')).toContainText('Waiting for microphone permission');
  await expect.poll(() => page.evaluate(() => {
    return (window as unknown as RecordingWindow).__melodyRecording.requests;
  })).toBe(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Capture cancelled');
  await page.evaluate(() => (window as unknown as RecordingWindow).__melodyRecording.resolvePermission());
  await expectReleasedStream(page);
  await expect(page.getByRole('button', { name: 'Record melody', exact: true })).toBeEnabled();
  expect(await page.locator('.note-event').evaluateAll(notes => notes.map(note => note.getAttribute('aria-label')))).toEqual(priorNotes);
  expect(await savedProject(page)).toEqual(priorSavedProject);
  await expect(page.getByRole('status')).toContainText('Capture cancelled');
  expect(errors).toEqual([]);
});

test('a real microphone stream ending completes recording automatically and restores capture controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installSyntheticMicrophone(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Record melody', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish recording', exact: true })).toBeVisible();
  await awaitCapturedTone(page);
  await page.evaluate(() => (window as unknown as RecordingWindow).__melodyRecording.stopInput());
  await expectReleasedStream(page);
  await expect(page.getByRole('status')).toContainText('Detected', { timeout: 20000 });
  await expect(page.getByLabel('Pitch (MIDI)')).toHaveValue('69');
  await expect(page.getByRole('button', { name: 'Record melody', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Finish recording', exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
