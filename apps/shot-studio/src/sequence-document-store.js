/** Atomic complete sequence saves; ordinary scene and take storage are separate. */
import {validateSequenceBundle,createSequenceDocument} from './sequence-document.js';
import {encodeSequenceArchive,decodeSequenceArchive,importLegacySequence} from './sequence-archive.js';

const DB='shot-studio-sequence-documents',STORE='state',KEY='sequence';
const LEGACY='shot-studio-sequence-v1',MAX_ARCHIVE=16*1024*1024,MAX_RAW=1024*1024,MAX_RECOVERY=2*1024*1024;
const encoder=new TextEncoder();
const fail=(code,message)=>Object.assign(new Error(message),{code});
const unavailable=()=>fail('storage','Sequence storage could not be read. Existing saved work is protected. Keep a complete backup and retry loading.');
const protectedError=()=>fail('protected','The saved sequence is protected. Review the actual saved copy before replacement, or retry loading.');
const conflict=()=>fail('conflict','The saved sequence or legacy draft changed. Memory work is kept. Review the current saved copy before replacing it.');
const cancelled=()=>fail('cancelled','Sequence storage operation cancelled. A completed transaction may already be durable; reload or review before saving.');
function legacyText(value){
  if(value===null)return null;
  if(typeof value!=='string'||value.length>MAX_RAW||encoder.encode(value).byteLength>MAX_RAW)throw protectedError();
  return value;
}
function scalar(value){return value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=128;}
function capture(present,raw){
  if(!present)return {present:false,comparable:true,row:null};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join('|')!=='archive|legacyRaw|revision|schemaVersion')return {present:true,comparable:false,row:null};
  try{
    if(!scalar(raw.schemaVersion)||!scalar(raw.revision)||!(raw.archive instanceof ArrayBuffer)||raw.archive.byteLength>MAX_ARCHIVE)throw protectedError();
    const row={schemaVersion:raw.schemaVersion,revision:raw.revision,archive:raw.archive.slice(0),legacyRaw:legacyText(raw.legacyRaw)};
    return {present:true,comparable:true,row};
  }catch{return {present:true,comparable:false,row:null};}
}
function canonical(snapshot){
  if(!snapshot.comparable||!snapshot.present||snapshot.row.schemaVersion!==1||!Number.isSafeInteger(snapshot.row.revision)||snapshot.row.revision<1)throw protectedError();
  return snapshot.row;
}
function same(a,b){
  if(!a.comparable||!b.comparable||a.present!==b.present)return false;
  if(!a.present)return true;
  const x=a.row,y=b.row;
  if(!Object.is(x.schemaVersion,y.schemaVersion)||!Object.is(x.revision,y.revision)||x.legacyRaw!==y.legacyRaw||x.archive.byteLength!==y.archive.byteLength)return false;
  const left=new Uint8Array(x.archive),right=new Uint8Array(y.archive);
  for(let i=0;i<left.length;i++)if(left[i]!==right[i])return false;
  return true;
}

export class SequenceDocumentStore {
  #factory;#legacy;#closed=false;#active=null;#expected=null;#baseline=null;#protected=true;
  #epoch=0;#receiptVersion=0;#receipts=new WeakMap();#rawArchive=null;#rawLegacy=null;#storageListener;
  constructor(factory=()=>globalThis.indexedDB,getLegacyStorage=()=>globalThis.localStorage){
    this.#factory=factory;this.#legacy=getLegacyStorage;
    this.#storageListener=event=>{
      if(this.#closed||event.key!==LEGACY&&event.key!==null)return;
      try{if(this.#readLegacy()!==this.#baseline)this.protect();}catch{this.protect();}
    };
    globalThis.addEventListener?.('storage',this.#storageListener);
  }
  get protected(){return this.#protected;}
  get hasRecoveryArchive(){return this.#rawArchive!==null;}
  get hasRecoveryLegacy(){return this.#rawLegacy!==null;}
  get nativePending(){return this.#active!==null;}
  #invalidate(){this.#epoch++;this.#receiptVersion++;this.#protected=true;this.#expected=null;}
  protect(){this.#invalidate();if(this.#active)this.#active.retire(protectedError());}
  #readLegacy(){
    let raw;
    try{raw=legacyText(this.#legacy().getItem(LEGACY));}catch(error){throw error?.code?error:unavailable();}
    this.#rawLegacy=raw;return raw;
  }
  #remember(snapshot){
    if(snapshot.comparable&&snapshot.present)this.#rawArchive=snapshot.row.archive.slice(0);
    else this.#rawArchive=null;
  }
  #token(kind,snapshot,legacyRaw,extra={}){
    const token=Object.freeze({});this.#receipts.set(token,{kind,snapshot,legacyRaw,epoch:this.#epoch,version:this.#receiptVersion,...extra});return token;
  }
  #receipt(token,kind){
    const proof=this.#receipts.get(token);
    if(!proof||proof.kind!==kind||proof.epoch!==this.#epoch||proof.version!==this.#receiptVersion||this.#closed)throw protectedError();
    return proof;
  }
  #operate(action,signal){
    if(this.#closed)return Promise.reject(fail('storage','Sequence storage is closed. Reload after its native work has drained.'));
    if(this.#active)return Promise.reject(fail('busy','Sequence storage is still draining its native operation. Wait, or reload if it never completes.'));
    this.#receiptVersion++;
    const epoch=this.#epoch,controller=new AbortController();let rejectLogical,reason=null;
    const logical=new Promise((_,reject)=>rejectLogical=reject);
    const operation={epoch,signal:controller.signal,tx:null,db:null,request:null,deadline:performance.now()+10000,
      check:()=>{
        if(!reason&&performance.now()>=operation.deadline)operation.retire(fail('timeout','Sequence storage timed out after 10 seconds. Existing saved work is protected until a fresh load or review.'));
        if(reason)throw reason;
        if(this.#closed||epoch!==this.#epoch)throw protectedError();
      },
      retire:error=>{
        if(reason)return;reason=error;this.#invalidate();controller.abort();
        try{operation.tx?.abort();}catch{/* Actual commit may already be terminal; never claim rollback. */}
        try{operation.request?.transaction?.abort();}catch{/* A pending/terminal open has no abortable transaction. */}
        rejectLogical(error);
      },drain:null,
    };
    this.#active=operation;
    const abort=()=>operation.retire(cancelled());
    const timer=setTimeout(()=>operation.retire(fail('timeout','Sequence storage timed out after 10 seconds. Existing saved work is protected until a fresh load or review.')),10000);
    let work;
    try{if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});operation.check();work=Promise.resolve(action(operation));}
    catch(error){work=Promise.reject(error);}
    work=work.catch(error=>{
      const safe=error?.code?error:unavailable();
      if(!reason)operation.retire(safe);
      throw reason??safe;
    });
    operation.drain=work.then(()=>{},()=>{}).finally(()=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(operation.db){operation.db.onversionchange=null;operation.db.close();operation.db=null;}
      if(this.#active===operation)this.#active=null;
    });
    // Logical rejection is prompt; the separate drain retains actual native ownership.
    return Promise.race([work,logical]).then(async value=>{await operation.drain;return value;});
  }
  #open(operation){
    operation.check();
    return new Promise((resolve,reject)=>{
      let request,finished=false;
      const finishError=error=>{if(finished)return;finished=true;reject(error);};
      try{const factory=this.#factory();if(!factory)throw unavailable();request=factory.open(DB,1);operation.request=request;}
      catch{finishError(unavailable());return;}
      request.onupgradeneeded=()=>{
        try{operation.check();const db=request.result;
          if(db.objectStoreNames.length===0)db.createObjectStore(STORE);
          else if(db.objectStoreNames.length!==1||!db.objectStoreNames.contains(STORE))throw protectedError();
        }catch(error){operation.retire(error?.code?error:unavailable());try{request.transaction?.abort();}catch{/* Wait for native open terminal. */}}
      };
      request.onerror=()=>{operation.request=null;finishError(unavailable());};
      request.onblocked=()=>{/* Deadline rejects logically; late native terminal still owns the slot. */};
      request.onsuccess=()=>{
        const db=request.result;operation.request=null;
        try{operation.check();if(finished){db.close();return;}
          if(db.version!==1||db.objectStoreNames.length!==1||!db.objectStoreNames.contains(STORE))throw protectedError();
          operation.db=db;db.onversionchange=()=>operation.retire(conflict());finished=true;resolve(db);
        }catch(error){db.close();finishError(error);}
      };
    });
  }
  #transaction(db,mode,operation,apply=null){
    operation.check();
    return new Promise((resolve,reject)=>{
      let tx,done=false,result,reason=null;
      const finish=error=>{if(done)return;done=true;operation.tx=null;if(error)reject(error);else resolve(result);};
      try{tx=db.transaction(STORE,mode);operation.tx=tx;}catch{reject(unavailable());return;}
      tx.onabort=()=>finish(reason??unavailable());
      tx.onerror=()=>{reason??=unavailable();operation.retire(reason);};
      tx.oncomplete=()=>{
        try{operation.check();if(reason)throw reason;if(result===undefined)throw unavailable();finish();}
        catch(error){finish(error);}
      };
      try{
        const store=tx.objectStore(STORE),key=store.getKey(KEY),row=store.get(KEY);let gotKey=false,gotRow=false;
        const admit=()=>{
          if(done||!gotKey||!gotRow)return;
          try{operation.check();const snapshot=capture(key.result!==undefined,row.result);this.#remember(snapshot);
            result=apply?apply(snapshot,store):snapshot;
          }catch(error){reason=error?.code?error:unavailable();operation.retire(reason);}
        };
        key.onsuccess=()=>{gotKey=true;admit();};row.onsuccess=()=>{gotRow=true;admit();};
      }catch(error){reason=error?.code?error:unavailable();operation.retire(reason);}
    });
  }
  load({signal}={}){
    return this.#operate(async operation=>{
      const db=await this.#open(operation),snapshot=await this.#transaction(db,'readonly',operation);operation.check();
      let value,legacyRaw,legacyChanged=false;
      if(snapshot.present){
        const row=canonical(snapshot);
        try{value=await decodeSequenceArchive(new Blob([row.archive]),{signal:operation.signal});}catch(error){operation.check();throw error?.code==='cancelled'?error:protectedError();}
        operation.check();legacyRaw=this.#readLegacy();legacyChanged=legacyRaw!==row.legacyRaw;
      }else{
        legacyRaw=this.#readLegacy();
        try{value=legacyRaw===null?{document:createSequenceDocument(),asset:null}:importLegacySequence(legacyRaw);}catch{throw protectedError();}
      }
      operation.check();const safe=validateSequenceBundle(value);
      return {bundle:safe,receipt:this.#token('load',snapshot,legacyRaw,{legacyChanged}),legacyChanged};
    },signal);
  }
  acceptLoad(receipt){
    if(this.#active)throw fail('busy','Wait for native sequence storage to finish before accepting its load.');
    const proof=this.#receipt(receipt,'load');
    if(this.#readLegacy()!==proof.legacyRaw){this.protect();throw conflict();}
    this.#receipts.delete(receipt);this.#expected=proof.snapshot;this.#baseline=proof.legacyRaw;this.#protected=proof.legacyChanged;
  }
  #write(bundle,proof,signal){
    let safe;
    try{safe=validateSequenceBundle(bundle);}catch(error){return Promise.reject(fail('invalid',error instanceof Error?error.message:'The complete sequence is invalid.'));}
    const expected=proof.snapshot,baseline=proof.legacyRaw;
    return this.#operate(async operation=>{
      const blob=await encodeSequenceArchive(safe,{signal:operation.signal});operation.check();
      if(!(blob instanceof Blob)||blob.size>MAX_ARCHIVE)throw fail('invalid','The complete sequence archive exceeds its 16 MiB limit.');
      const archive=await blob.arrayBuffer();operation.check();
      if(this.#readLegacy()!==baseline)throw conflict();
      const db=await this.#open(operation);
      const saved=await this.#transaction(db,'readwrite',operation,(current,store)=>{
        if(!same(current,expected))throw conflict();
        if(this.#readLegacy()!==baseline)throw conflict();
        const previous=current.present?current.row.revision:0;
        if(Number.isSafeInteger(previous)&&previous>=Number.MAX_SAFE_INTEGER)throw protectedError();
        const revision=Number.isSafeInteger(previous)&&previous>=0?previous+1:1;
        const row={schemaVersion:1,revision,archive,legacyRaw:baseline};store.put(row,KEY);
        return capture(true,row);
      });
      operation.check();
      if(this.#readLegacy()!==baseline){this.#remember(saved);throw conflict();}
      this.#expected=saved;this.#baseline=baseline;this.#protected=false;this.#rawArchive=null;this.#rawLegacy=null;
    },signal);
  }
  save(bundle,{signal}={}){
    if(this.#closed)return Promise.reject(fail('storage','Sequence storage is closed.'));
    if(this.#active)return Promise.reject(fail('busy','Sequence storage is still draining its native operation.'));
    if(this.#protected||!this.#expected)return Promise.reject(protectedError());
    return this.#write(bundle,{snapshot:this.#expected,legacyRaw:this.#baseline},signal);
  }
  reviewReplacement({signal}={}){
    return this.#operate(async operation=>{
      const db=await this.#open(operation),snapshot=await this.#transaction(db,'readonly',operation);operation.check();
      if(!snapshot.comparable)throw protectedError();
      const legacyRaw=this.#readLegacy();let readable=!snapshot.present,title=null;
      if(snapshot.present){
        try{canonical(snapshot);const value=await decodeSequenceArchive(new Blob([snapshot.row.archive]),{signal:operation.signal});operation.check();readable=true;title=value.document.sequence.title;}
        catch{operation.check();}
      }
      operation.check();
      return {summary:{present:snapshot.present,revision:snapshot.present&&Number.isSafeInteger(snapshot.row.revision)?snapshot.row.revision:null,
        archiveBytes:snapshot.present?snapshot.row.archive.byteLength:null,readable,title,
        legacyChanged:snapshot.present&&snapshot.row.legacyRaw!==legacyRaw},receipt:this.#token('replace',snapshot,legacyRaw)};
    },signal);
  }
  replaceSaved(bundle,receipt,{signal}={}){
    if(this.#active)return Promise.reject(fail('busy','Sequence storage is still draining its native operation.'));
    let proof;
    try{proof=this.#receipt(receipt,'replace');}catch(error){return Promise.reject(error);}
    this.#receipts.delete(receipt);return this.#write(bundle,proof,signal);
  }
  recoveryArchive(){
    if(!this.#rawArchive)throw protectedError();
    return new Blob([this.#rawArchive],{type:'application/octet-stream'});
  }
  recoveryLegacyJson(){
    if(this.#rawLegacy===null)throw protectedError();
    const text=JSON.stringify({kind:'shot-studio-sequence-recovery',raw:this.#rawLegacy});
    if(text.length>MAX_RECOVERY||encoder.encode(text).byteLength>MAX_RECOVERY)throw protectedError();return text;
  }
  async close(){
    if(!this.#closed){this.#closed=true;globalThis.removeEventListener?.('storage',this.#storageListener);this.#invalidate();this.#active?.retire(cancelled());}
    await this.#active?.drain;
  }
}
