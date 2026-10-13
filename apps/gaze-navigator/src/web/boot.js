// Starts the web navigator with pointer tracking on the page that imports it.
import { startWebNavigator } from './overlay.js';

window.gazeNavigator = startWebNavigator({ window });
