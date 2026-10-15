// Injected into the isolated world. Import is cached; the factory starts a fresh owned runtime.
if (!globalThis.__gazeNavigatorRunning) {
  const owner = {};
  let navigator = null;
  const current = () => globalThis.__gazeNavigatorOwner === owner;
  globalThis.__gazeNavigatorOwner = owner;
  globalThis.__gazeNavigatorRunning = true;
  globalThis.__gazeNavigatorReady = false;
  globalThis.__gazeNavigatorError = '';
  // Install Stop before import or storage can wait, so cancellation also owns startup.
  globalThis.__gazeNavigatorStop = () => {
    if (!current()) return;
    globalThis.__gazeNavigatorOwner = null;
    globalThis.__gazeNavigatorRunning = false;
    globalThis.__gazeNavigatorReady = false;
    globalThis.__gazeNavigatorStop = undefined;
    navigator?.stop();
  };
  globalThis.__gazeNavigatorStart = import(chrome.runtime.getURL('src/web/extension-boot.js'))
    .then(module => current() ? module.startExtensionNavigator({ isCurrent: current }) : null)
    .then(started => {
      if (!current()) { started?.stop(); return false; }
      if (!started) { globalThis.__gazeNavigatorStop(); return false; }
      navigator = started;
      globalThis.__gazeNavigatorReady = true;
      return true;
    })
    .catch(error => {
      if (current()) {
        globalThis.__gazeNavigatorStop();
        globalThis.__gazeNavigatorError = 'Gaze Navigator could not start. Try again or reload this page.';
        console.error('Gaze Navigator could not start', error);
      }
      return false;
    });
}
// Do not make executeScript await startup: a pending import must remain stoppable.
void 0;
