import { FPS, HEIGHT, WIDTH, type Project } from './model.ts';
import { createFrameRenderer, type Assets, type FrameRenderer } from './render.ts';

export interface TweenPreview {
  readonly frame: number;
  showFrame(frame: number): void;
  play(): void;
  stop(): void;
  dispose(): void;
}

export function createTweenPreview(
  canvas: HTMLCanvasElement, candidate: Project, assets: Assets,
  startFrame: number, endFrame: number, onFrame: (frame: number) => void,
): TweenPreview {
  // Preparation admits and captures the complete graph/bindings once. No canvas
  // access occurs until the candidate, callback and inclusive range are valid.
  let renderer: FrameRenderer | null = createFrameRenderer(candidate, assets);
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame)
    || startFrame < 0 || endFrame < startFrame || endFrame >= renderer.frameCount) {
    throw new Error('Tween preview frames must be integers within the candidate timeline.');
  }
  if (typeof onFrame !== 'function') throw new Error('Tween preview needs a frame callback.');
  let context = canvas.getContext('2d');
  if (!context) throw new Error('Tween preview canvas is unavailable.');
  canvas.width = WIDTH; canvas.height = HEIGHT;

  let frame = startFrame, disposed = false, playing = false;
  let pending: number | null = null, epoch = 0;
  let callback: ((frame: number) => void) | null = onFrame;
  let originTime = 0, originFrame = startFrame;

  function stop(): void {
    playing = false; epoch++;
    if (pending !== null) cancelAnimationFrame(pending);
    pending = null;
  }

  function draw(next: number): void {
    if (disposed) return;
    try {
      renderer!.render(context!, next);
      frame = next;
      callback?.(frame);
    } catch (error) {
      // A failing owner or released bitmap must not leave a hidden animation.
      stop(); throw error;
    }
  }

  function schedule(owner: number): void {
    if (!disposed && playing && owner === epoch && pending === null) {
      pending = requestAnimationFrame(timestamp => tick(timestamp, owner));
    }
  }

  function tick(timestamp: number, owner: number): void {
    // A callback already delivered by the browser can outlive cancellation.
    // It must neither draw nor clear a replacement owner's pending callback.
    if (disposed || !playing || owner !== epoch) return;
    pending = null;
    const elapsed = Math.max(0, timestamp - originTime);
    const next = Math.min(endFrame, originFrame + Math.floor(elapsed * FPS / 1000));
    if (next === endFrame) playing = false;
    if (next !== frame) draw(next);
    // onFrame may have sought, stopped, disposed, or started a fresh playback.
    schedule(owner);
  }

  function play(): void {
    if (disposed || playing) return;
    const owner = ++epoch;
    playing = true;
    originTime = performance.now();
    originFrame = frame === endFrame ? startFrame : frame;
    if (frame === endFrame) draw(startFrame);
    schedule(owner);
  }

  function dispose(): void {
    if (disposed) return;
    stop(); disposed = true;
    callback = null; renderer = null; context = null;
    // Only the dedicated surface is owned. ImageBitmap bindings are borrowed.
    canvas.width = 0; canvas.height = 0;
  }

  const preview: TweenPreview = Object.freeze({
    get frame() { return frame; },
    showFrame(next: number): void {
      if (disposed) return;
      if (!Number.isInteger(next) || next < startFrame || next > endFrame) {
        throw new Error('Tween preview frame must be an integer within the selected range.');
      }
      // Explicit seeking pauses, so the next play starts at the selected frame.
      stop(); draw(next);
    },
    play, stop, dispose,
  });
  try { draw(startFrame); }
  catch (error) { dispose(); throw error; }
  return preview;
}
