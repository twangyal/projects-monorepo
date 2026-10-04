import { WIDTH, HEIGHT, FPS } from './model.ts';
import type { Project } from './model.ts';
import { createFrameRenderer } from './render.ts';
import type { Assets, FrameRenderer } from './render.ts';

export interface TweenPreview {
  readonly frame: number;
  showFrame(frame: number): void;
  play(): void;
  stop(): void;
  dispose(): void;
}

/** Own a detached renderer and one rAF callback, borrowing the editor's assets. */
export function createTweenPreview(canvas: HTMLCanvasElement, candidate: Project, assets: Assets,
  startFrame: number, endFrame: number, onFrame: (frame: number) => void): TweenPreview {
  let renderer: FrameRenderer | null = createFrameRenderer(candidate, assets);
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0
    || endFrame < startFrame || endFrame >= renderer.frameCount) throw new Error('Preview endpoints must be within the admitted timeline.');
  if (typeof onFrame !== 'function') throw new Error('Preview frame callback is required.');
  let context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas preview is unavailable.');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  let current = startFrame, disposed = false, running = false, owner = 0, request: number | null = null;
  let notify: ((frame: number) => void) | null = onFrame;
  function stop(): void {
    owner++; running = false;
    if (request !== null) cancelAnimationFrame(request);
    request = null;
  }
  function show(frame: number): void {
    renderer!.render(context!, frame); current = frame; notify?.(frame);
  }
  show(current);
  return Object.freeze({
    get frame() { return current; },
    showFrame(frame: number): void {
      if (disposed) return;
      if (!Number.isInteger(frame) || frame < startFrame || frame > endFrame) throw new Error('Choose an integer preview frame between the endpoints.');
      stop(); show(frame);
    },
    play(): void {
      if (disposed || running) return;
      const token = ++owner;
      let beganAt: number | null = null;
      running = true;
      try { if (current === endFrame) show(startFrame); }
      catch (error) { stop(); throw error; }
      if (disposed || !running || token !== owner) return;
      const beginFrame = current;
      function tick(time: number): void {
        if (disposed || !running || token !== owner) return;
        request = null; beganAt ??= time;
        const next = Math.min(endFrame, beginFrame + Math.floor(Math.max(0, time - beganAt) * FPS / 1000));
        try { if (next !== current) show(next); }
        catch (error) { stop(); throw error; }
        // Notifications can synchronously dispose, scrub or stop the preview.
        if (disposed || !running || token !== owner) return;
        if (next === endFrame) { running = false; return; }
        request = requestAnimationFrame(tick);
      }
      request = requestAnimationFrame(tick);
    },
    stop,
    dispose(): void {
      if (disposed) return;
      disposed = true; stop(); notify = null; renderer = null; context = null; canvas.width = canvas.height = 0;
    },
  });
}
