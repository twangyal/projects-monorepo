import type { Page } from '@playwright/test';

/** Native fixture adapter. Legacy seeds stay legacy; existing libraries target their actual active row. */
export async function nativeCurrentRaw(page: Page, write?: { value: unknown }): Promise<unknown> {
  return page.evaluate(({ write }) => new Promise<unknown>((resolve, reject) => {
    const opened = indexedDB.open('motion-studio', 2);
    opened.onerror = () => reject(opened.error);
    opened.onupgradeneeded = () => {
      for (const name of ['project', 'library', 'projects']) {
        if (!opened.result.objectStoreNames.contains(name)) opened.result.createObjectStore(name);
      }
    };
    opened.onsuccess = () => {
      const db = opened.result;
      const tx = db.transaction(['project', 'library', 'projects'], write ? 'readwrite' : 'readonly');
      let result: unknown;
      const headRequest = tx.objectStore('library').get('current');
      headRequest.onsuccess = () => {
        const head = headRequest.result as { schemaVersion: number; activeId: string | null; revision: string; entries: { id: string; revision: string; title: string; frameCount: number; layerCount: number; projectBytes: number }[] } | undefined;
        const id = head?.activeId;
        if (head && !id) { tx.abort(); reject(new Error('Fixture requires an active project or absent library; an empty library cannot fall back to legacy.')); return; }
        const store = tx.objectStore(id ? 'projects' : 'project');
        const key = id ?? 'current';
        if (!write) {
          const read = store.get(key); read.onsuccess = () => { result = read.result; };
          return;
        }
        let value = write.value;
        // Canonical known-good fixture documents receive an independently constructed
        // row and matching metadata; malformed values are stored exactly as supplied.
        if (id && head && value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 2) {
          const project = value as unknown as { title: string; frameCount: number; layers: unknown[] };
          const revision = crypto.randomUUID();
          value = { schemaVersion: 1, id, revision, project };
          const entry = head.entries.find(item => item.id === id)!;
          Object.assign(entry, { revision, title: project.title, frameCount: project.frameCount, layerCount: project.layers.length, projectBytes: new TextEncoder().encode(JSON.stringify(project)).byteLength });
          head.revision = crypto.randomUUID();
          tx.objectStore('library').put(head, 'current');
        }
        store.put(value, key); result = value;
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Native fixture transaction aborted.')); };
      tx.onerror = () => { /* onabort is the terminal failure. */ };
    };
  }), { write });
}

/** Portable artwork expectation, separate from exact preserved native-row backups. */
export async function nativeCurrent(page: Page, write?: { value: unknown }): Promise<unknown> {
  const value = await nativeCurrentRaw(page, write);
  return value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1 && 'project' in value ? value.project : value;
}

/** The migration source stays unchanged after canonical library writes. */
export async function nativeLegacyRaw(page: Page): Promise<unknown> {
  return page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const opened = indexedDB.open('motion-studio', 2);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result, tx = db.transaction('project');
      const read = tx.objectStore('project').get('current');
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
