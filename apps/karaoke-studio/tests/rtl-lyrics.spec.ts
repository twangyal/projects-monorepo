import { test, expect } from '@playwright/test';

function silence(seconds: number): Buffer {
  const frames = seconds * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  return wav;
}

// Each line, its base direction, the rows it wraps into, and each row's words from left to right as drawn (indices
// into the row's own words).
const phrases = [
  { text: 'مرحبا بالعالم', direction: 'rtl', rows: ['مرحبا بالعالم'], order: [[1, 0]] },
  { text: 'שלום עולם 123', direction: 'rtl', rows: ['שלום עולם 123'], order: [[2, 1, 0]] },
  { text: 'Sing مرحبا 123 now!', direction: 'ltr', rows: ['Sing مرحبا 123 now!'], order: [[0, 2, 1, 3]] },
  { text: 'אני אוהב you baby', direction: 'rtl', rows: ['אני אוהב you baby'], order: [[2, 3, 1, 0]] },
  { text: Array(20).fill('مرحبا').join(' '), direction: 'rtl', rows: [8, 8, 4].map(count => Array(count).fill('مرحبا').join(' ')),
    order: [8, 8, 4].map(count => [...Array(count).keys()].reverse()) },
];

test('RTL and mixed lyrics light their words where the line shows them, shaped whole through seeks, and LTR keeps its timing', async ({ page }, info) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'rtl.wav', mimeType: 'audio/wav', buffer: silence(16) });
  await expect(page.locator('#message')).toContainText('Your stems', { timeout: 15000 });
  await page.getByLabel('Paste lyrics, one line per cue').fill([...phrases.map(phrase => phrase.text), 'LEFT RIGHT'].join('\n'));
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  // The clip's recognized lines are replaced once the pasted ones are timed (at once, or after aligning them).
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(phrases[0]!.text);
  const seek = (time: number) => page.locator('audio').evaluate((node, at) => { (node as HTMLAudioElement).currentTime = at; node.dispatchEvent(new Event('timeupdate')); }, time);
  for (const [index, phrase] of phrases.entries()) {
    const start = Number(await page.getByLabel(`Start line ${index + 1}`, { exact: true }).inputValue());
    const end = Number(await page.getByLabel(`End line ${index + 1}`, { exact: true }).inputValue());
    const seen = new Set<string>();
    for (const fraction of [0.05, 0.3, 0.55, 0.8]) {
      await seek(start + fraction * (end - start));
      await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', String(index));
      await expect(page.locator('#stage')).not.toHaveAttribute('data-word-timing', 'none');
      // Which words are lit: those whose first character is among the sung ones, row by row.
      let left = Number(await page.locator('#stage').getAttribute('data-sung'));
      const lit = phrase.rows.map(row => row.split(' ').map(word => { const on = left > 0; left -= Math.min(left, [...word].length); return on; }));
      seen.add(JSON.stringify(lit));
      // Independent canvas oracle: the rows drawn whole in each colour. Every pixel must be one or the other (nothing
      // split or reshaped), and each word's ink, found where the two drawings differ, all in the colour it should be.
      const result = await page.locator('#stage').evaluate((node, { phrase, lit }) => {
        const draw = (fill: string) => {
          const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#14232f'; context.fillRect(0, 0, 1280, 720);
          context.font = '44px KaraokeSans'; context.textAlign = 'center'; context.textBaseline = 'middle';
          context.direction = phrase.direction as CanvasDirection; context.fillStyle = fill;
          phrase.rows.forEach((row, index) => context.fillText(row, 640, 320 + (index - (phrase.rows.length - 1) / 2) * 55));
          return context.getImageData(0, 0, 1280, 720).data;
        };
        const unsung = draw('#f7f5ed'), sung = draw('#e4b77d');
        const actual = (node as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1280, 720).data;
        const delta = (a: Uint8ClampedArray, b: Uint8ClampedArray, k: number) => Math.abs(a[k]! - b[k]!) + Math.abs(a[k + 1]! - b[k + 1]!) + Math.abs(a[k + 2]! - b[k + 2]!);
        let neither = 0;
        for (let y = 200; y < 440; y++) for (let x = 0; x < 1280; x++) {
          const k = (y * 1280 + x) * 4;
          // GPU/CPU canvas antialiasing differs by at most two levels per channel.
          if (delta(actual, unsung, k) > 6 && delta(actual, sung, k) > 6) neither++;
        }
        const problems: string[] = [];
        phrase.rows.forEach((_row, row) => {
          const middle = 320 + (row - (phrase.rows.length - 1) / 2) * 55, top = Math.round(middle - 26), bottom = Math.round(middle + 26);
          const ink = (x: number) => { for (let y = top; y < bottom; y++) if (delta(unsung, sung, (y * 1280 + x) * 4) > 30) return true; return false; };
          const runs: [number, number][] = [];
          for (let x = 0; x < 1280; x++) if (ink(x)) { const last = runs.at(-1); if (last && x - last[1] < 14) last[1] = x; else runs.push([x, x]); }
          if (runs.length !== phrase.order[row]!.length) { problems.push(`row ${row}: ${runs.length} words of ink`); return; }
          runs.forEach(([low, high], position) => {
            const word = phrase.order[row]![position]!, reference = lit[row]![word] ? sung : unsung;
            let wrong = 0;
            for (let y = top; y < bottom; y++) for (let x = low; x <= high; x++) if (delta(actual, reference, (y * 1280 + x) * 4) > 6) wrong++;
            if (wrong) problems.push(`row ${row} word ${word}: ${wrong} pixels in the wrong colour`);
          });
        });
        return { neither, problems };
      }, { phrase, lit });
      const where = JSON.stringify({ text: phrase.text, fraction, lit });
      expect(result.neither, where).toBe(0);
      expect(result.problems, where).toEqual([]);
    }
    // The words light in turn: part way through, some are lit and some are not.
    expect(seen.size, phrase.text).toBeGreaterThan(1);
  }
  // At the start of the first line only its first word, on the right, is lit.
  const firstStart = Number(await page.getByLabel('Start line 1', { exact: true }).inputValue());
  await seek(firstStart + 0.05);
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '5');
  await page.locator('#stage').screenshot({ path: info.outputPath('rtl-first-word.png') });
  // Existing LTR partial highlighting still has both sung and unsung pixels.
  const leftStart = Number(await page.getByLabel(`Start line ${phrases.length + 1}`, { exact: true }).inputValue());
  await seek(leftStart + 0.1);
  const colours = await page.locator('#stage').evaluate(node => {
    const pixels = (node as HTMLCanvasElement).getContext('2d')!.getImageData(100, 220, 1080, 210).data;
    let accent = 0, main = 0;
    for (let k = 0; k < pixels.length; k += 4) {
      if (pixels[k] === 228 && pixels[k + 1] === 183 && pixels[k + 2] === 125) accent++;
      if (pixels[k] === 247 && pixels[k + 1] === 245 && pixels[k + 2] === 237) main++;
    }
    return { accent, main };
  });
  expect(colours.accent).toBeGreaterThan(100); expect(colours.main).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
});
