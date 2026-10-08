import {expect} from '@playwright/test';

// #124 compatibility: inspect the actual complete IDB row without producer imports.
// Existing sequence geometry/trim expectations remain literal and unchanged.
export async function sequenceStoredState(page){
  await expect(page.locator('#sequence-save-status')).not.toHaveText(/^(Reading|Saving)/);
  const stored=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('shot-studio-sequence-documents',1);
    request.onerror=()=>reject(request.error);
    request.onupgradeneeded=()=>request.transaction.abort();
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('state','readonly'),store=tx.objectStore('state');
      const key=store.getKey('sequence'),value=store.get('sequence');
      tx.onerror=()=>{db.close();reject(tx.error);};
      tx.onabort=()=>{db.close();reject(tx.error);};
      tx.oncomplete=()=>{db.close();resolve({present:key.result!==undefined,
        row:key.result===undefined?null:{schemaVersion:value.result.schemaVersion,revision:value.result.revision,
          legacyRaw:value.result.legacyRaw,archive:Array.from(new Uint8Array(value.result.archive))},
        legacy:localStorage.getItem('shot-studio-sequence-v1')});};
    };
  }));
  if(!stored.present)return {...stored,archive:null,document:null};
  const archive=Buffer.from(stored.row.archive);
  expect(stored.row.schemaVersion).toBe(1);expect(stored.row.revision).toBeGreaterThan(0);
  expect(archive.subarray(0,8).toString()).toBe('SHOTSEQ1');
  const metadata=archive.readUInt32LE(8),wav=archive.readUInt32LE(12);
  expect(archive.length).toBe(16+metadata+wav);
  const document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(archive.subarray(16,16+metadata)));
  expect(document.kind).toBe('shot-studio-sequence-document');expect(document.schemaVersion).toBe(1);
  return {...stored,archive,document};
}
export async function storedSequenceText(page){
  const stored=await sequenceStoredState(page);
  return stored.present?JSON.stringify(stored.document.sequence):stored.legacy;
}
export function legacySequenceText(page){return page.evaluate(()=>localStorage.getItem('shot-studio-sequence-v1'));}
