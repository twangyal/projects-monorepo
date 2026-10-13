// Hosts the on-device matching model for every tab, in the extension's own origin: it downloads once
// per browser, is cached in extension storage (never a website's), and pages only see role/name lists.
import { loadAssistantModel } from './vendor/assistant.js';

let loading = null;
function model(tabId) {
  loading ??= loadAssistantModel((received, total) => {
    chrome.runtime.sendMessage({ type: 'gaze:assist-progress', tabId, received, total }).catch(() => {});
  }).catch(error => { loading = null; throw error; });
  return loading;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.target !== 'gaze-offscreen') return false;
  (async () => {
    const loaded = await model(message.tabId);
    if (message.op === 'load') return true;
    if (message.op === 'decide') return loaded.decide(...message.args);
    if (message.op === 'yes') return loaded.yes(...message.args);
    throw new Error('Unknown matching request.');
  })().then(result => respond({ ok: true, result }), error => respond({ ok: false, message: error.message }));
  return true;
});
