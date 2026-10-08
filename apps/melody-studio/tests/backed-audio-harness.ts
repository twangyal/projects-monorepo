// Test-only entry: genuine graph and production processor, independent input/oracle data.
import { BACKED_PROCESSOR_NAME, backedWorkletUrl } from '../src/backed-recorder.ts';

type Mode = 'exact' | 'finish' | 'missing' | 'topology' | 'duplicate-arm' | 'cancel' | 'initially-missing' | 'progress';
type Options = { rate: number; mode: Mode; channels?: number };
type Message = Record<string, unknown>;
type Result = {
  rate: number; sourceFrame: number; startFrame: number; requestedEnd: number;
  messages: Message[]; samples: number[] | null; maximumOutput: number;
  closed: boolean; sourceStops: number; initialReadyCount: number;
};
let options: Options = { rate: 44100, mode: 'exact', channels: 2 };
let result: Result | null = null;
let failure: string | null = null;
let running = false;
let completion: Promise<void> | null = null;

async function run(): Promise<void> {
  if (running) throw new Error('Only one actual graph fixture at a time.');
  running = true; result = null; failure = null;
  const context = new AudioContext({ sampleRate: options.rate });
  let processor: AudioWorkletNode | null = null;
  const sources: AudioBufferSourceNode[] = [];
  const messages: Message[] = [];
  let stops = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const summary: Result = { rate: context.sampleRate, sourceFrame: 0, startFrame: 0, requestedEnd: 0,
    messages, samples: null, maximumOutput: 0, closed: false, sourceStops: 0, initialReadyCount: 0 };
  try {
    await context.resume();
    if (context.sampleRate !== options.rate) throw new Error('Requested native sample rate not available.');
    await context.audioWorklet.addModule(await backedWorkletUrl());
    processor = new AudioWorkletNode(context, BACKED_PROCESSOR_NAME, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 2, channelCountMode: 'max', channelInterpretation: 'discrete',
    });
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    processor.connect(analyser).connect(context.destination);
    const meter = new Float32Array(2048);
    const observeOutput = () => { analyser.getFloatTimeDomainData(meter); for (const v of meter) summary.maximumOutput = Math.max(summary.maximumOutput, Math.abs(v)); };
    let ready!: () => void, armed!: () => void, done!: () => void, failed!: (e: Error) => void;
    const readiness = new Promise<void>(resolve => { ready = resolve; });
    const acknowledgement = new Promise<void>(resolve => { armed = resolve; });
    const terminal = new Promise<void>((resolve, reject) => { done = resolve; failed = reject; });
    // Observe early terminal errors without an unhandled promise before readiness awaits.
    void terminal.catch(() => {});
    const bounded = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, terminal.then(() => { throw new Error('Terminal result before expected setup boundary.'); })]);
    processor.onprocessorerror = () => failed(new Error('Native processor failed.'));
    processor.port.onmessage = ({ data }: MessageEvent<Message>) => {
      observeOutput();
      if (!data || typeof data.type !== 'string') { failed(new Error('Malformed native protocol envelope.')); return; }
      if (data.type === 'complete') {
        if (!(data.samples instanceof Float32Array)) { failed(new Error('Complete result lacks native Float32 samples.')); return; }
        summary.samples = Array.from(data.samples);
        messages.push({ ...data, samples: { frames: data.samples.length } }); done();
      } else {
        messages.push(data);
        if (data.type === 'ready') ready();
        if (data.type === 'armed') armed();
        if (data.type === 'error') done();
      }
    };
    timer = setTimeout(() => failed(new Error('Native fixture exceeded its eight-second bound.')), 8000);
    const graphUntil = async (seconds: number) => { while (context.currentTime < seconds) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); };
    if (options.mode === 'initially-missing') {
      await graphUntil(context.currentTime + .075);
      summary.initialReadyCount = messages.filter(m => m.type === 'ready').length;
    }
    const channels = options.channels ?? 2;
    const input = context.createBuffer(channels, context.sampleRate * 6, context.sampleRate);
    for (let channel = 0; channel < channels; channel++) {
      const samples = input.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] = channel === 0 ? ((i % 29) - 14) / 32 : ((i % 31) - 15) / 64;
    }
    const source = context.createBufferSource(); source.buffer = input; source.connect(processor); sources.push(source);
    summary.sourceFrame = Math.ceil((context.currentTime + .025) * context.sampleRate);
    source.start(summary.sourceFrame / context.sampleRate);
    await bounded(readiness);
    // Independently derived count-in; no import of the production plan helper.
    const countInFrame = Math.ceil((context.currentTime + .15) * context.sampleRate);
    summary.startFrame = countInFrame + Math.round(4 * 60 * context.sampleRate / 137);
    const frames = options.mode === 'progress' ? Math.round(context.sampleRate * 1.25) : 1003;
    summary.requestedEnd = summary.startFrame + frames;
    const limitFrame = options.mode === 'finish' ? summary.startFrame + 12000 : summary.requestedEnd;
    processor.port.postMessage({ type: 'arm', startFrame: summary.startFrame, limitFrame });
    if (options.mode === 'duplicate-arm') {
      processor.port.postMessage({ type: 'arm', startFrame: summary.startFrame, limitFrame });
    } else {
      await bounded(acknowledgement);
      if (options.mode === 'missing') source.disconnect();
      if (options.mode === 'topology') {
        source.disconnect(); const mono = context.createBufferSource(); mono.buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        mono.connect(processor); mono.start(); sources.push(mono);
      }
      if (options.mode === 'cancel') {
        processor.port.postMessage({ type: 'cancel' });
        await graphUntil((countInFrame + context.sampleRate / 8) / context.sampleRate);
      }
      if (options.mode === 'finish') {
        // Deliver Finish after at least the requested end was genuinely processed.
        await graphUntil((summary.requestedEnd + 384) / context.sampleRate);
        processor.port.postMessage({ type: 'finish', stopFrame: summary.requestedEnd });
      }
    }
    if (options.mode !== 'cancel') await terminal;
    observeOutput();
    result = summary;
  } catch (error) { failure = error instanceof Error ? error.message : 'Native fixture failed.'; }
  finally {
    clearTimeout(timer);
    for (const source of sources) { try { source.stop(); stops++; } catch { /* Already naturally ended. */ } source.disconnect(); }
    if (processor) { processor.port.onmessage = null; processor.disconnect(); processor.port.close(); }
    await context.close(); summary.closed = context.state === 'closed'; summary.sourceStops = stops;
    running = false;
  }
}
Object.defineProperty(window, 'backedAudioHarness', { value: Object.freeze({
  configure(next: Options) { if (running) throw new Error('An actual graph is still owned.'); options = { ...next }; },
  state: () => ({ running, result, failure }),
  settled: () => completion,
}) });
document.querySelector('#run-audio')!.addEventListener('click', () => { completion = run(); });
document.querySelector('#audio-ready')!.textContent = 'Real AudioWorklet harness ready';
