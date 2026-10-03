import { expect, test, type Page } from '@playwright/test';

async function aim(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true });
  const box = await button.boundingBox();
  if (!box) throw new Error(`Missing target ${label}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: 'Confirm action', exact: true })).toBeEnabled();
}

test('simulation highlights, requires confirmation, navigates, and stops', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try simulation' }).click();
  await aim(page, 'Open The quiet web');
  await expect(page.getByRole('heading', { name: 'The quiet web', exact: true })).not.toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'The quiet web', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
  await aim(page, 'Save article');
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unsave article' })).toBeVisible();
  await aim(page, 'Scroll down');
  await page.keyboard.press('Space');
  await expect.poll(() => page.locator('#reading-pane').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause assistant' }).click();
  await expect(page.getByText('Assistant paused', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('moving away expires the target and cannot trigger an action', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try simulation' }).click();
  await aim(page, 'Open The quiet web');
  await page.mouse.move(5, 5);
  await expect(page.getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'The quiet web', exact: true })).not.toBeVisible();
});

test('camera denial recovers into simulation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start webcam' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Camera permission was denied' })).toBeVisible();
  await page.getByRole('button', { name: 'Try simulation' }).click();
  await aim(page, 'Open The quiet web');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'The quiet web', exact: true })).toBeVisible();
});

test('mobile layout has no horizontal overflow and normal controls work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open The quiet web' }).click();
  await expect(page.getByRole('heading', { name: 'The quiet web', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: 'Show design articles' }).click();
  await expect(page.getByRole('button', { name: 'Open A place to think' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open The quiet web' })).not.toBeVisible();
});

test('real local vision assets initialize and no-face tracking stays safe', async ({ page }) => {
  test.setTimeout(60000);
  const requests: string[] = [];
  const failures: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start webcam' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Camera ready' })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText('Face or open eyes not detected', { exact: true })).toBeVisible({ timeout: 10000 });
  expect(requests.some(url => url.endsWith('.wasm'))).toBe(true);
  expect(requests.some(url => url.endsWith('.data'))).toBe(true);
  expect(requests.every(url => url.startsWith('http://127.0.0.1:4173/'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Calibrate gaze' }).click();
  await expect(page.getByText('Point 1 of 9 · look at the lavender dot')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Pause assistant' }).click();
  expect(await page.locator('#camera-video').evaluate(video => (video as HTMLVideoElement).srcObject)).toBeNull();
  expect(failures).toEqual([]);
});

test('switching modes while permission is pending stops a late camera stream', async ({ page }) => {
  await page.addInitScript(() => {
    const runtime = window as unknown as { resolveCamera: (stream: MediaStream) => void };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => new Promise<MediaStream>(resolve => { runtime.resolveCamera = resolve; }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start webcam' }).click();
  await expect(page.getByText('Starting…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try simulation' }).click();
  await page.evaluate(() => {
    const runtime = window as unknown as { resolveCamera: (stream: MediaStream) => void; lateStream: MediaStream };
    const canvas = document.createElement('canvas');
    runtime.lateStream = canvas.captureStream();
    runtime.resolveCamera(runtime.lateStream);
  });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { lateStream: MediaStream }).lateStream.getTracks().every(track => track.readyState === 'ended'),
  )).toBe(true);
  await expect(page.getByText('Simulation', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calibrate gaze' })).toBeDisabled();
});

test('hiding a tab pauses the assistant and clears the recommendation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try simulation' }).click();
  await aim(page, 'Open The quiet web');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('Assistant paused because this tab was hidden.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
});

test('mobile simulation can confirm a lower card without scrolling away from it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try simulation' }).click();
  await page.getByRole('button', { name: 'Open Take the long way' }).scrollIntoViewIfNeeded();
  await aim(page, 'Open Take the long way');
  const confirm = page.getByRole('button', { name: 'Confirm action', exact: true });
  await expect(confirm).toBeInViewport();
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Take the long way', exact: true })).toBeVisible();
});

test('saving and unsaving preserve the reading position', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open The quiet web' }).click();
  await page.locator('#reading-pane').evaluate(el => { el.scrollTop = 300; });
  await expect.poll(() => page.locator('#reading-pane').evaluate(el => el.scrollTop)).toBe(300);
  await page.getByRole('button', { name: 'Save article' }).click();
  await expect(page.getByRole('button', { name: 'Unsave article' })).toBeVisible();
  await expect.poll(() => page.locator('#reading-pane').evaluate(el => el.scrollTop)).toBe(300);
  await page.getByRole('button', { name: 'Unsave article' }).click();
  await expect.poll(() => page.locator('#reading-pane').evaluate(el => el.scrollTop)).toBe(300);
});

test('an occluded target loses its recommendation before confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try simulation' }).click();
  await aim(page, 'Open The quiet web');
  await page.getByRole('button', { name: 'Open The quiet web' }).evaluate(target => {
    const box = target.getBoundingClientRect();
    const cover = document.createElement('div');
    Object.assign(cover.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`,
      width: `${box.width}px`, height: `${box.height}px`, zIndex: '20', background: 'white' });
    document.getElementById('workspace')!.append(cover);
  });
  await expect(page.getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'The quiet web', exact: true })).not.toBeVisible();
});
