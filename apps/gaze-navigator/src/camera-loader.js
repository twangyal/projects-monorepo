const CAMERA_SCRIPT = 'https://cdn.jsdelivr.net/npm/webgazer@3.3.0/dist/webgazer.js';

export function createCameraLoader(document, window, timeoutMs = 15000) {
  let pending = null;
  let loadedScript = null;
  return function load({ fresh = false } = {}) {
    if (fresh) {
      window.webgazer = undefined;
      loadedScript?.remove();
      loadedScript = null;
      pending = null;
    }
    if (window.webgazer) return Promise.resolve(window.webgazer);
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CAMERA_SCRIPT;
      script.async = true;
      let timer;
      const cleanup = () => {
        window.clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
      };
      const fail = message => {
        cleanup();
        script.remove();
        pending = null;
        reject(new Error(message));
      };
      script.onload = () => {
        if (!window.webgazer) return fail('Camera library did not load correctly.');
        cleanup();
        loadedScript = script;
        resolve(window.webgazer);
      };
      script.onerror = () => fail('Camera library could not load.');
      timer = window.setTimeout(() => fail('Camera library load timed out.'), timeoutMs);
      document.head.append(script);
    });
    return pending;
  };
}
