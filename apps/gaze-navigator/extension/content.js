// Injected into the page's isolated world; the navigator module loads from the extension.
if (!globalThis.__gazeNavigatorRunning) {
  globalThis.__gazeNavigatorRunning = true;
  import(chrome.runtime.getURL('src/web/extension-boot.js')).catch(error => {
    globalThis.__gazeNavigatorRunning = false;
    console.error('Gaze Navigator could not start', error);
  });
}
