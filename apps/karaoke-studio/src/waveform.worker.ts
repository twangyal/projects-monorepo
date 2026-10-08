import { MAX_WAVEFORM_BYTES, NormalizedWavPeaks, WaveformError } from './waveform.ts';
import type { WaveformWorkerReply, WaveformWorkerRequest } from './waveform.ts';

let used = false;

function emit(reply: WaveformWorkerReply): void { self.postMessage(reply); }

function request(value: unknown): WaveformWorkerRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'duration,projectId') {
    throw new WaveformError('Invalid waveform request. Reload the project and retry.');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.projectId !== 'string' || !/^[0-9a-f]{32}$/.test(candidate.projectId)
    || typeof candidate.duration !== 'number' || !Number.isFinite(candidate.duration)
    || candidate.duration < 1 || candidate.duration > 300) {
    throw new WaveformError('Invalid waveform project or duration. Reload the project and retry.');
  }
  return { projectId: candidate.projectId, duration: candidate.duration };
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (used) return;
  used = true;
  const deadline = performance.now() + 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      throw new WaveformError('Waveform loading timed out. Retry or use playback and the time fields.');
    }
  };
  try {
    const { projectId, duration } = request(event.data);
    const parser = new NormalizedWavPeaks(duration);
    let lastProgress = performance.now();
    emit({ type: 'progress', framesRead: 0, totalFrames: 0 });
    check();
    const response = await fetch(`/api/projects/${projectId}/audio/original`, {
      cache: 'no-store', redirect: 'error', credentials: 'omit', signal: controller.signal,
    });
    check();
    if (response.status !== 200 || !response.body) {
      throw new WaveformError('Original audio is unavailable. Retry or keep editing with playback.');
    }
    const length = response.headers.get('Content-Length');
    let declared: number | undefined;
    if (length !== null) {
      if (!/^[0-9]{1,10}$/.test(length)) throw new WaveformError('Invalid original audio length. Retry the waveform.');
      declared = Number(length);
      if (declared > MAX_WAVEFORM_BYTES) throw new WaveformError('Original WAV exceeds the supported waveform byte limit.');
    }
    reader = response.body.getReader();
    let received = 0;
    while (true) {
      check();
      const next = await reader.read();
      check();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > MAX_WAVEFORM_BYTES || (declared !== undefined && received > declared)) {
        throw new WaveformError('Original audio exceeds its supported or declared length.');
      }
      for (let offset = 0; offset < next.value.length; offset += 65536) {
        check();
        parser.push(next.value.subarray(offset, offset + 65536));
        const now = performance.now();
        if (now - lastProgress >= 100 && parser.totalFrames > 0) {
          emit({ type: 'progress', framesRead: parser.framesRead, totalFrames: parser.totalFrames });
          lastProgress = now;
        }
      }
    }
    if (declared !== undefined && received !== declared) throw new WaveformError('Original WAV stream is truncated. Retry the waveform.');
    const peaks = parser.finish();
    check();
    self.postMessage({ type: 'ready', peaks } satisfies WaveformWorkerReply, { transfer: [peaks.minima.buffer, peaks.maxima.buffer] });
  } catch (error) {
    const timedOut = controller.signal.aborted || performance.now() >= deadline;
    emit({ type: 'error', message: timedOut
      ? 'Waveform loading timed out. Retry or use playback and the time fields.'
      : error instanceof WaveformError ? error.message : 'Could not load the original waveform. Retry or keep editing with playback.' });
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    self.close();
  }
};
