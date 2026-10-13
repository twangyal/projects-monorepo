// Starts the web navigator with pointer tracking on the page that imports it.
import { startWebNavigator } from './overlay.js';
import { loadWaterSheepInBrowser } from './watersheep-browser.js';

// Smarter matching loads the vendored runtime (npm run vendor:watersheep) and downloads the model once.
// Automated browser tests may supply a small stand-in model instead of the 158 MB download.
const runtimeBase = new URL('../../dist/vendor/watersheep/', import.meta.url).href;
const loadAssistant = window.__gazeTestAssistant ? async () => window.__gazeTestAssistant : progress => loadWaterSheepInBrowser({ runtimeBase, progress });
window.gazeNavigator = startWebNavigator({ window, loadAssistant });
