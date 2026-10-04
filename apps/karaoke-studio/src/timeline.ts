import type { Cue } from './lyrics.ts';
import { formatTime } from './lyrics.ts';
import { timingError, proposeBoundary, quantizeBoundaryDelta, timeWindow, timeToPixel, pixelToTime, type CueBoundary, type TimeWindow } from './timing.ts';
import type { WaveformPeaks } from './waveform.ts';

export interface TimelineEditor {
  projectId: string; projectGeneration: number; editGeneration: number;
  duration: number; cues: readonly Cue[]; busy: boolean;
}
export interface BoundaryCommit {
  projectId: string; projectGeneration: number; editGeneration: number;
  cueIndex: number; boundary: CueBoundary; before: number; after: number;
}
export interface TimelineCallbacks {
  onSeek(time: number): void;
  onSelectCue(index: number): void;
  onGestureStart(): boolean;
  onCommitBoundary(change: BoundaryCommit): boolean;
}
export interface TimelineController {
  setEditor(editor: TimelineEditor | null): void;
  setPlayback(time: number): void;
  selectCue(index: number): void;
  cancelGesture(): void;
  stopWaveform(): void;
  destroy(): void;
}
interface GestureGeometry {
  viewportWidth: number; viewportHeight: number; dpr: number;
  left: number; top: number; width: number; height: number;
}
interface Gesture {
  change: BoundaryCommit; original: number; proposed: number; mode: 'pointer' | 'keyboard';
  pointerId?: number; originX: number; width: number; span: number; ticks: number;
  keys: Set<string>; handle: HTMLElement; geometry: GestureGeometry;
}

export function mountTimeline(root: HTMLElement, callbacks: TimelineCallbacks): TimelineController {
  root.innerHTML = `
    <div class="waveform-heading"><div><h4>Original audio waveform</h4><p class="fine">Amplitude from the original recording, regardless of the audition track. It does not identify words or align lyrics.</p></div><button id="waveform-stop" type="button" hidden>Stop waveform</button><button id="waveform-retry" type="button" hidden>Retry waveform</button></div>
    <p id="waveform-status" role="status" class="fine">Open a clip to load its waveform.</p><progress id="waveform-progress" aria-label="Waveform frames decoded" hidden></progress>
    <canvas id="waveform-overview" height="72" aria-label="Full song waveform; click to seek"></canvas>
    <label class="field">Seek in song<input id="waveform-seek" type="range" min="0" max="1" step="0.001" value="0" disabled></label>
    <div class="waveform-toolbar"><label class="field">Detail window<select id="waveform-zoom"><option value="60">60 seconds</option><option value="15">15 seconds</option><option value="5">5 seconds</option></select></label><button id="waveform-prev" type="button">Previous window</button><button id="waveform-next" type="button">Next window</button><button id="waveform-center" type="button">Center on playhead</button><output id="waveform-window"></output></div>
    <div class="waveform-detail-wrap"><canvas id="waveform-detail" height="116" aria-label="Detailed original waveform; click to seek"></canvas><div class="waveform-handle-lane start-lane"><div id="cue-start-handle" role="slider" tabindex="0" aria-label="Selected cue start" aria-orientation="horizontal"><span>Start</span></div></div><div class="waveform-handle-lane end-lane"><div id="cue-end-handle" role="slider" tabindex="0" aria-label="Selected cue end" aria-orientation="horizontal"><span>End</span></div></div></div>
    <div class="waveform-selection"><label class="field">Selected lyric cue<select id="waveform-cue"><option value="">No cues</option></select></label><p class="fine">Drag a boundary, or focus its handle and use arrow keys (10 ms; Shift: 100 ms). Changes remain provisional until release. Escape cancels.</p></div>
    <p id="waveform-edit-status" class="fine" role="status"></p>`;
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const overview = get<HTMLCanvasElement>('waveform-overview'), detail = get<HTMLCanvasElement>('waveform-detail');
  const seek = get<HTMLInputElement>('waveform-seek'), zoom = get<HTMLSelectElement>('waveform-zoom');
  const selector = get<HTMLSelectElement>('waveform-cue');
  const handles = { start: get('cue-start-handle'), end: get('cue-end-handle') };
  const lifetime = new AbortController();
  const listen = (target: EventTarget, event: string, handler: EventListener) => target.addEventListener(event, handler, { signal: lifetime.signal });
  let editor: TimelineEditor | null = null, peaks: WaveformPeaks | null = null, worker: Worker | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined, destroyed = false, selected = -1, playback = 0;
  let window: TimeWindow = { start: 0, end: 1 }, gesture: Gesture | null = null;
  let canvasWidth = 1, canvasDpr = 1, loading = false, invalidTiming: string | null = null;
  const suppressedKeys = new Set<string>();
  const report = (text: string) => { get('waveform-status').textContent = text; };
  const editStatus = (text: string) => { get('waveform-edit-status').textContent = text; };
  function releaseWorker() {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined; worker?.terminate(); worker = null; loading = false;
    get('waveform-stop').hidden = true; get('waveform-progress').hidden = true;
  }
  function failWaveform(message: string) {
    releaseWorker(); report(message); get('waveform-retry').hidden = !editor;
  }
  function loadWaveform() {
    cancelGesture(); releaseWorker(); peaks = null;
    if (!editor || destroyed) return;
    get('waveform-retry').hidden = true; get('waveform-stop').hidden = false;
    const projectId = editor.projectId, projectGeneration = editor.projectGeneration;
    report('Loading original waveform…'); loading = true;
    try {
      const owner = new Worker(new URL('./waveform.worker.ts', import.meta.url), { type: 'module' });
      worker = owner;
      const current = () => !destroyed && worker === owner && editor?.projectId === projectId && editor.projectGeneration === projectGeneration;
      timeout = setTimeout(() => { if (current()) failWaveform('Waveform loading exceeded 30 seconds. Playback and numeric editing remain available. Retry waveform.'); }, 30000);
      owner.addEventListener('message', event => {
        if (!current()) return;
        const data = event.data;
        if (data?.type === 'progress') {
          const progress = get<HTMLProgressElement>('waveform-progress');
          if (Number.isFinite(data.totalFrames) && data.totalFrames > 0 && Number.isFinite(data.framesRead)) {
            progress.max = data.totalFrames; progress.value = data.framesRead; progress.hidden = false;
            report(`Loading original waveform: ${Math.floor(data.framesRead / data.totalFrames * 100)}% of audio frames decoded.`);
          }
        } else if (data?.type === 'ready') {
          peaks = data.peaks as WaveformPeaks; releaseWorker();
          report(`Original waveform ready · ${peaks.frameCount.toLocaleString('en-US')} frames · ${peaks.minima.length.toLocaleString('en-US')} amplitude bins.`);
          draw();
        } else if (data?.type === 'error') failWaveform(typeof data.message === 'string' ? data.message.slice(0, 300) : 'Waveform could not load. Retry waveform; numeric editing remains available.');
      });
      owner.addEventListener('error', event => { event.preventDefault(); if (current()) failWaveform('Waveform could not load. Retry waveform; playback and numeric editing remain available.'); });
      owner.addEventListener('messageerror', () => { if (current()) failWaveform('Waveform result could not be read. Retry waveform.'); });
      owner.postMessage({ projectId, duration: editor.duration });
    } catch { failWaveform('This browser could not start the waveform worker. Playback and numeric editing remain available.'); }
    draw();
  }
  function cancelGesture() {
    const previous = gesture; gesture = null;
    if (previous?.mode === 'keyboard') for (const key of previous.keys) suppressedKeys.add(key);
    if (previous?.pointerId !== undefined && previous.handle.hasPointerCapture(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId);
    if (previous) { editStatus('Timing gesture cancelled. Your lyric draft is unchanged.'); draw(); }
  }
  function stopWaveform() {
    cancelGesture();
    if (!loading) return;
    releaseWorker(); report('Waveform stopped. Playback and numeric editing remain available.'); get('waveform-retry').hidden = !editor;
  }
  function validity(): string | null { return editor ? invalidTiming : 'Open a clip to edit timing.'; }
  function canEdit() { return !!editor && !editor.busy && selected >= 0 && selected < editor.cues.length && validity() === null; }
  function configure() {
    const available = !!editor;
    seek.disabled = !available; seek.max = String(editor?.duration || 1);
    zoom.disabled = !available; selector.disabled = !available || !editor?.cues.length;
    get<HTMLButtonElement>('waveform-prev').disabled = !available || window.start <= 0;
    get<HTMLButtonElement>('waveform-next').disabled = !available || window.end >= (editor?.duration || 0);
    get<HTMLButtonElement>('waveform-center').disabled = !available;
    const reason = validity();
    if (!gesture) editStatus(reason || (editor?.busy ? 'Timing controls paused while the studio is busy.' : selected < 0 ? 'Select a cue to adjust its timing.' : 'Timing edits are unsaved until you choose Save lyrics.'));
    for (const handle of Object.values(handles)) { handle.setAttribute('aria-disabled', String(!canEdit())); handle.tabIndex = canEdit() ? 0 : -1; }
  }
  function choose(index: number) {
    cancelGesture();
    if (!editor || !Number.isInteger(index) || index < 0 || index >= editor.cues.length) return;
    selected = index; selector.value = String(index);
    const cue = editor.cues[index];
    if (Number.isFinite(cue.start) && Number.isFinite(cue.end)) window = timeWindow(editor.duration, Number(zoom.value) as 5 | 15 | 60, (cue.start + cue.end) / 2);
    callbacks.onSelectCue(index); configure(); draw();
  }
  function setWindow(center: number) {
    cancelGesture(); if (!editor) return;
    window = timeWindow(editor.duration, Number(zoom.value) as 5 | 15 | 60, center); configure(); draw();
  }
  function seekTo(time: number) {
    if (!editor) return;
    cancelGesture(); callbacks.onSeek(Math.max(0, Math.min(editor.duration, time)));
  }
  function drawCanvas(canvas: HTMLCanvasElement, view: TimeWindow, height: number) {
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0); ctx.clearRect(0, 0, canvasWidth, height);
    ctx.fillStyle = '#f0f3eb'; ctx.fillRect(0, 0, canvasWidth, height);
    ctx.strokeStyle = '#cdd8ca'; ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(canvasWidth, height / 2); ctx.stroke();
    if (editor && validity() === null) {
      for (let i = 0; i < editor.cues.length; i++) {
        const cue = editor.cues[i], start = gesture?.change.cueIndex === i && gesture.change.boundary === 'start' ? gesture.proposed : cue.start;
        const end = gesture?.change.cueIndex === i && gesture.change.boundary === 'end' ? gesture.proposed : cue.end;
        if (end < view.start || start > view.end) continue;
        ctx.fillStyle = i === selected ? '#cddcb899' : '#819c8230';
        ctx.fillRect(timeToPixel(start, view, canvasWidth), 0, Math.max(1, timeToPixel(end, view, canvasWidth) - timeToPixel(start, view, canvasWidth)), height);
      }
    }
    if (peaks) {
      ctx.strokeStyle = '#4a7770'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < canvasWidth; x++) {
        const from = Math.max(0, Math.floor((view.start + x / canvasWidth * (view.end - view.start)) * 100));
        const to = Math.min(peaks.minima.length, Math.ceil((view.start + (x + 1) / canvasWidth * (view.end - view.start)) * 100));
        let minimum = 32767, maximum = -32768;
        for (let bin = from; bin < to; bin++) { minimum = Math.min(minimum, peaks.minima[bin]); maximum = Math.max(maximum, peaks.maxima[bin]); }
        if (to > from) {
          const top = height / 2 - maximum / 32768 * height * .42;
          const bottom = height / 2 - minimum / 32768 * height * .42;
          const middle = (top + bottom) / 2;
          // Constant nonzero bins still have amplitude: a zero-length butt-cap
          // stroke would hide them. Keep at least one logical display pixel.
          ctx.moveTo(x + .5, Math.min(top, middle - .5));
          ctx.lineTo(x + .5, Math.max(bottom, middle + .5));
        }
      }
      ctx.stroke();
    }
    if (playback >= view.start && playback <= view.end) { const x = timeToPixel(playback, view, canvasWidth); ctx.strokeStyle = '#bc773c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  }
  function draw() {
    if (destroyed) return;
    drawCanvas(overview, { start: 0, end: editor?.duration || 1 }, 72); drawCanvas(detail, window, 116);
    detail.dataset.windowStart = String(window.start); detail.dataset.windowEnd = String(window.end);
    get('waveform-window').textContent = `${formatTime(window.start)} – ${formatTime(window.end)}`;
    for (const boundary of ['start', 'end'] as const) {
      const handle = handles[boundary], cue = editor?.cues[selected];
      const value = gesture?.change.boundary === boundary ? gesture.proposed : cue?.[boundary];
      const inView = value !== undefined && Number.isFinite(value) && value >= window.start && value <= window.end;
      handle.hidden = !inView;
      if (inView) {
        handle.style.left = `clamp(22px, ${(value - window.start) / (window.end - window.start) * 100}%, calc(100% - 22px))`;
        handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', String(editor!.duration)); handle.setAttribute('aria-valuenow', String(value));
        handle.setAttribute('aria-valuetext', `${boundary} ${value.toFixed(3)} seconds`); handle.firstElementChild!.textContent = `${boundary === 'start' ? 'Start' : 'End'} ${value.toFixed(3)}s`;
      }
    }
  }
  function resize() {
    const width = Math.max(1, Math.min(4096, Math.floor(detail.getBoundingClientRect().width))), dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    if (width === canvasWidth && dpr === canvasDpr) return;
    cancelGesture(); canvasWidth = width; canvasDpr = dpr;
    for (const [canvas, height] of [[overview, 72], [detail, 116]] as const) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    draw();
  }
  function captureGeometry(): GestureGeometry {
    const rect = detail.getBoundingClientRect();
    return { viewportWidth: globalThis.window.innerWidth, viewportHeight: globalThis.window.innerHeight, dpr: globalThis.devicePixelRatio, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  function ensureGestureGeometry(): boolean {
    if (!gesture) return false;
    const before = gesture.geometry, now = captureGeometry();
    // Resize events and observer callbacks may arrive after pointer/key release.
    // Read actual layout synchronously before previewing or committing instead
    // of treating notification delivery as proof that the mapping is current.
    if (before.viewportWidth === now.viewportWidth && before.viewportHeight === now.viewportHeight && before.dpr === now.dpr
      && before.left === now.left && before.top === now.top && before.width === now.width && before.height === now.height) return true;
    cancelGesture();
    editStatus('Timing gesture cancelled because the view moved or resized. Your lyric draft is unchanged.');
    return false;
  }
  function begin(boundary: CueBoundary, mode: 'pointer' | 'keyboard', handle: HTMLElement): Gesture | null {
    if (!canEdit() || !callbacks.onGestureStart()) return null;
    cancelGesture();
    const base = editor!, original = base.cues[selected][boundary], geometry = captureGeometry();
    gesture = { change: { projectId: base.projectId, projectGeneration: base.projectGeneration, editGeneration: base.editGeneration, cueIndex: selected, boundary, before: original, after: original }, original, proposed: original, mode, originX: 0, width: geometry.width, span: window.end - window.start, ticks: 0, keys: new Set(), handle, geometry };
    return gesture;
  }
  function preview(value: number) {
    if (!gesture || !editor || !ensureGestureGeometry()) return;
    gesture.proposed = value; gesture.change.after = value;
    try { proposeBoundary(editor.cues, editor.duration, selected, gesture.change.boundary, value); editStatus(`Provisional ${gesture.change.boundary}: ${value.toFixed(3)} seconds. Release to apply; Escape cancels.`); }
    catch { editStatus('This boundary would overlap a cue or make an empty interval. Release rejects it; Escape cancels.'); }
    draw();
  }
  function finish() {
    const completed = gesture; if (!completed || !editor || !ensureGestureGeometry()) return;
    gesture = null;
    if (completed.pointerId !== undefined && completed.handle.hasPointerCapture(completed.pointerId)) completed.handle.releasePointerCapture(completed.pointerId);
    if (Object.is(completed.original, completed.proposed)) { editStatus('Timing unchanged.'); draw(); return; }
    try {
      proposeBoundary(editor.cues, editor.duration, completed.change.cueIndex, completed.change.boundary, completed.proposed);
      if (!callbacks.onCommitBoundary(completed.change)) { editStatus('Timing gesture expired; your current draft was kept.'); draw(); return; }
      editStatus('Timing boundary changed. Undo lyric edit restores its original value; save explicitly before exporting.');
    } catch { editStatus('Timing change rejected: keep nonoverlapping, nonempty cues within the song. Your draft is unchanged.'); }
    draw();
  }
  for (const boundary of ['start', 'end'] as const) {
    const handle = handles[boundary];
    listen(handle, 'pointerdown', event => {
      const pointer = event as PointerEvent; if (pointer.button !== 0 || !pointer.isPrimary) return;
      const current = begin(boundary, 'pointer', handle); if (!current) return;
      pointer.preventDefault(); handle.focus({ preventScroll: true }); current.pointerId = pointer.pointerId; current.originX = pointer.clientX; handle.setPointerCapture(pointer.pointerId);
    });
    listen(handle, 'pointermove', event => {
      const pointer = event as PointerEvent; if (gesture?.mode !== 'pointer' || gesture.pointerId !== pointer.pointerId) return;
      preview(quantizeBoundaryDelta(gesture.original, (pointer.clientX - gesture.originX) / gesture.width * gesture.span, editor!.duration));
    });
    listen(handle, 'pointerup', event => { const pointer = event as PointerEvent; if (gesture?.mode === 'pointer' && gesture.pointerId === pointer.pointerId) finish(); });
    for (const eventName of ['pointercancel', 'lostpointercapture']) listen(handle, eventName, event => { if (gesture?.mode === 'pointer' && gesture.handle === handle && gesture.pointerId === (event as PointerEvent).pointerId) cancelGesture(); });
    listen(handle, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key.key)) return;
      key.preventDefault();
      if (!key.repeat) suppressedKeys.delete(key.key);
      if (suppressedKeys.has(key.key)) return;
      if (gesture && (gesture.mode !== 'keyboard' || gesture.handle !== handle)) cancelGesture();
      const current = gesture || begin(boundary, 'keyboard', handle); if (!current) return;
      current.keys.add(key.key); current.ticks += (key.key === 'ArrowLeft' || key.key === 'ArrowDown' ? -1 : 1) * (key.shiftKey ? 10 : 1);
      preview(quantizeBoundaryDelta(current.original, current.ticks / 100, editor!.duration));
    });
    listen(handle, 'keyup', event => {
      const key = event as KeyboardEvent;
      if (gesture?.mode !== 'keyboard' || gesture.handle !== handle || !gesture.keys.has(key.key)) return;
      key.preventDefault(); gesture.keys.delete(key.key); if (!gesture.keys.size) finish();
    });
    listen(handle, 'blur', () => { if (gesture?.handle === handle) cancelGesture(); });
  }
  listen(globalThis.window, 'blur', cancelGesture);
  // A viewport resize can move a centered canvas without changing its width.
  listen(globalThis.window, 'resize', () => { cancelGesture(); resize(); });
  listen(globalThis.window, 'keyup', event => { suppressedKeys.delete((event as KeyboardEvent).key); });
  listen(globalThis.window, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') cancelGesture(); });
  listen(overview, 'click', event => { if (!editor) return; const rect = overview.getBoundingClientRect(); const value = pixelToTime((event as MouseEvent).clientX - rect.left, { start: 0, end: editor.duration }, rect.width); seekTo(value); setWindow(value); });
  listen(detail, 'click', event => { if (!editor) return; const rect = detail.getBoundingClientRect(); seekTo(pixelToTime((event as MouseEvent).clientX - rect.left, window, rect.width)); });
  listen(seek, 'input', () => seekTo(Number(seek.value)));
  listen(selector, 'change', () => choose(Number(selector.value)));
  listen(zoom, 'change', () => setWindow((window.start + window.end) / 2));
  listen(get('waveform-prev'), 'click', () => setWindow((window.start + window.end) / 2 - (window.end - window.start)));
  listen(get('waveform-next'), 'click', () => setWindow((window.start + window.end) / 2 + (window.end - window.start)));
  listen(get('waveform-center'), 'click', () => setWindow(playback));
  listen(get('waveform-stop'), 'click', stopWaveform);
  listen(get('waveform-retry'), 'click', loadWaveform);
  const observer = new ResizeObserver(resize); observer.observe(detail);
  configure(); resize(); draw();
  return {
    setEditor(next) {
      if (destroyed) return;
      const replacement = next?.projectId !== editor?.projectId || next?.projectGeneration !== editor?.projectGeneration;
      if (replacement || next?.editGeneration !== editor?.editGeneration || next?.busy !== editor?.busy) cancelGesture();
      // Retain only bounded labels and timing numbers, never copy arbitrary raw
      // lyric drafts into this rendering/controller state.
      invalidTiming = next ? timingError(next.cues, next.duration) : null;
      editor = next ? { ...next, cues: next.cues.slice(0, 200).map(cue => ({ start: cue.start, end: cue.end, text: typeof cue.text === 'string' ? cue.text.slice(0, 80) : '' })) } : null;
      if (replacement) { releaseWorker(); peaks = null; selected = editor?.cues.length ? 0 : -1; playback = 0; window = timeWindow(editor?.duration || 1, Number(zoom.value) as 5 | 15 | 60, 0); }
      if (selected >= (editor?.cues.length || 0)) selected = editor?.cues.length ? editor.cues.length - 1 : -1;
      selector.replaceChildren();
      if (!editor?.cues.length) selector.append(new Option('No cues', ''));
      else for (const [i, cue] of editor.cues.entries()) selector.append(new Option(`${i + 1}. ${cue.text}`, String(i)));
      selector.value = selected < 0 ? '' : String(selected);
      if (selected >= 0) callbacks.onSelectCue(selected);
      configure(); draw();
      if (replacement && editor) loadWaveform();
      else if (!editor) { report('Open a clip to load its waveform.'); get('waveform-retry').hidden = true; }
    },
    setPlayback(time) { if (destroyed) return; playback = Number.isFinite(time) ? Math.max(0, Math.min(editor?.duration || 0, time)) : 0; seek.value = String(playback); draw(); },
    selectCue: choose, cancelGesture, stopWaveform,
    destroy() { if (destroyed) return; cancelGesture(); releaseWorker(); destroyed = true; observer.disconnect(); lifetime.abort(); root.replaceChildren(); },
  };
}
