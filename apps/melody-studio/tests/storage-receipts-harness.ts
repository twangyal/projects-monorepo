// Test-only Vite entry. No fixture values, mocked IDB or expected-state logic.
import { ReferenceStorage, SavedCopyConflict } from '../src/reference-storage.ts';

Object.defineProperty(window, 'storageReceiptHarness', {
  value: Object.freeze({ ReferenceStorage, SavedCopyConflict }), writable: false, configurable: false,
});
const ready = document.querySelector('#storage-receipts-ready');
if (ready) ready.textContent = 'Storage receipt harness ready';
