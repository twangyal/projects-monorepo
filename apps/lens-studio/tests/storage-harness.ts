import { loadProject, saveProject, clearProject } from '../src/storage.ts';
import { createDemoProject } from '../src/demo.ts';
import { decodeMask } from '../src/model.ts';
import { decodePhoto } from '../src/images.ts';
import type { Project } from '../src/types.ts';

function fixture(title = 'Captured study'): Project {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 3;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#b87b54';
  ctx.fillRect(0, 0, 4, 3);
  return {
    schemaVersion: 1, id: crypto.randomUUID(), title,
    photo: { id: crypto.randomUUID(), width: 4, height: 3, dataUrl: canvas.toDataURL('image/png') },
    settings: { mode: 'fixed', sourceFocal: 50, targetFocal: 50, shiftX: 0, shiftY: 0, near: 0.6, far: 2 },
    depth: { width: 4, height: 3, labels: btoa(String.fromCharCode(...Array<number>(12).fill(1))) },
  };
}

async function rawRecord(value?: unknown, write = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('lens-studio.v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('projects');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('projects', write ? 'readwrite' : 'readonly');
      const request = write ? tx.objectStore('projects').put(value, 'current') : tx.objectStore('projects').get('current');
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

export const harness = { loadProject, saveProject, clearProject, createDemoProject, decodeMask, decodePhoto, fixture, rawRecord };
declare global { interface Window { lensStorage: typeof harness } }
window.lensStorage = harness;
