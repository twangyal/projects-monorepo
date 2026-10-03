import { eligibleTargets, buildChoiceRequest, parseChoiceResponse } from './decision-contract.js';

const ORIGIN = 'http://127.0.0.1:11434';
const MAX_RESPONSE_BYTES = 262144;
const abortError = () => new DOMException('Cancelled', 'AbortError');

async function readJSON(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    response.body?.cancel().catch(() => {});
    throw new Error('Local response exceeds the size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Local response has no JSON body');
  const decoder = new TextDecoder();
  let size = 0, content = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { reader.cancel().catch(() => {}); throw new Error('Local response exceeds the size limit'); }
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(content); }
  catch { throw new Error('Local response is not valid JSON'); }
}

export function createLocalDecisionModel({ model = 'tev1:0.8b-q8_0', fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
  if (typeof model !== 'string' || model.length > 80 || !/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?(?::[a-z0-9][a-z0-9._-]*)?$/i.test(model) ||
      /(?:cloud|local)$/i.test(model.split(':').at(-1))) throw new Error('Choose a local model name without a cloud/local source suffix');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || typeof fetchImpl !== 'function') throw new Error('Invalid local adapter options');
  const name = model.includes(':') ? model : `${model}:latest`;
  let preparation = null;
  let digest = null;
  const localName = `${name}:local`;

  async function request(path, body, signal) {
    if (signal?.aborted) throw signal.reason ?? abortError();
    const controller = new AbortController();
    const fromCaller = () => controller.abort(signal.reason ?? abortError());
    signal?.addEventListener('abort', fromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Local request timed out', 'TimeoutError')), timeoutMs);
    let rejectAbort;
    const cancellation = new Promise((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason ?? abortError());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const work = Promise.resolve().then(async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await fetchImpl(ORIGIN + path, { method: body ? 'POST' : 'GET',
        credentials: 'omit', redirect: 'error', cache: 'no-store', mode: 'cors',
        headers: body ? { 'content-type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      if (controller.signal.aborted) { response.body?.cancel().catch(() => {}); throw controller.signal.reason; }
      if (!response.ok) {
        response.body?.cancel().catch(() => {});
        throw new Error(`Local Ollama request failed (HTTP ${response.status}); check local-only mode, version, and installed model.`);
      }
      return readJSON(response);
    });
    try { return await Promise.race([work, cancellation]); }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', fromCaller);
      controller.signal.removeEventListener('abort', rejectAbort);
    }
  }

  async function prepare(signal) {
    const status = await request('/api/status', null, signal);
    if (status?.cloud?.disabled !== true) throw new Error('Ollama must report cloud disabled. Restart it with OLLAMA_NO_CLOUD=1; older servers without this status are refused.');
    const tags = await request('/api/tags', null, signal);
    const installed = tags?.models?.find?.(item => item.name === name || item.model === name);
    if (!installed || installed.remote_host || installed.remote_model || installed.details?.format !== 'gguf' ||
        typeof installed.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(installed.digest) || !Number.isFinite(installed.size) || installed.size <= 0) {
      throw new Error('Selected model must be an installed local GGUF model with a digest. No model is downloaded by this app.');
    }
    const info = await request('/api/show', { model: localName }, signal);
    if (info?.remote_host || info?.remote_model || info?.details?.format !== 'gguf' || !info?.capabilities?.includes?.('decision')) {
      throw new Error('Selected model must have local GGUF decision capability; remote and chat-only models are refused.');
    }
    digest = installed.digest;
  }

  return {
    id: `Ollama/${name}`, kind: 'local', get digest() { return digest; },
    async decide(task, { signal } = {}) {
      if (signal?.aborted) throw signal.reason ?? abortError();
      if (!eligibleTargets(task).length) return { targetId: null, confidence: null };
      preparation ??= prepare(signal);
      await preparation;
      const response = await request('/v1/systemone', buildChoiceRequest(task, localName), signal);
      if (response?.remote_host || response?.remote_model) throw new Error('Remote model response refused');
      return parseChoiceResponse(task, response);
    },
  };
}
