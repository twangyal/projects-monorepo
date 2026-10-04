/** Separate saved-take storage; scene drafts and history remain independent. */
import {TakeError,validateLibrary} from './takes.js';
import {sha256Blob} from './take-archive.js';

const emptyLibrary=()=>({schemaVersion:1,revision:0,records:[]});
const failure=(code,message)=>new TakeError(code,message);
const storageError=()=>failure('storage','The take library could not be accessed. Keep a complete take backup and retry.');
const protectedError=()=>failure('protected','The saved take library is unreadable or invalid. It has been preserved. Retry reading before saving.');
const closedError=()=>failure('storage','Take library storage is closed. Reload the page to reopen it.');
const conflictError=()=>failure('conflict','The take library changed in another tab. Reload the library before saving.');

export class TakeStore {
  #factory;#closed=false;#operations=new Set();#connections=new Map();
  constructor(factory=()=>globalThis.indexedDB){this.#factory=factory;}

  #release(db){if(this.#connections.delete(db))db.close();}

  #operate(action,signal){
    if(this.#closed)return Promise.reject(closedError());
    const controller=new AbortController();
    let reason=null,rejectCancellation;
    const cancelled=new Promise((_,reject)=>{rejectCancellation=reject;});
    const operation={signal:controller.signal,
      check:()=>{if(reason)throw reason;if(this.#closed)throw closedError();},
      cancel:error=>{
        if(reason)return;reason=error;controller.abort();
        for(const [db,owner] of this.#connections)if(owner===operation)this.#release(db);
        rejectCancellation(error);
      },
    };
    const abort=()=>operation.cancel(failure('cancelled','Take library operation cancelled.'));
    this.#operations.add(operation);
    const timer=setTimeout(()=>operation.cancel(failure('timeout','Take library storage timed out after 10 seconds. Keep a backup and retry.')),10000);
    let work;
    try{
      if(signal?.aborted)abort();
      else signal?.addEventListener('abort',abort,{once:true});
      operation.check();work=action(operation);
    }catch(error){work=Promise.reject(error);}
    return Promise.race([work,cancelled]).finally(()=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      this.#operations.delete(operation);
      for(const [db,owner] of this.#connections)if(owner===operation)this.#release(db);
    });
  }

  #open(operation){
    operation.check();
    return new Promise((resolve,reject)=>{
      let request,settled=false;
      const finishError=error=>{
        try{request?.transaction?.abort();}catch{/* A retired upgrade may already be terminal. */}
        if(settled)return;settled=true;operation.signal.removeEventListener('abort',abort);
        reject(error);
      };
      const abort=()=>{try{operation.check();}catch(error){finishError(error);}};
      operation.signal.addEventListener('abort',abort,{once:true});
      try{
        const factory=this.#factory();
        if(!factory)throw storageError();
        request=factory.open('shot-studio-takes',1);
      }catch{finishError(storageError());return;}
      request.onupgradeneeded=()=>{
        try{
          operation.check();
          if(settled)throw closedError();
          const db=request.result;
          if(db.objectStoreNames.length===0)db.createObjectStore('state');
          else if(db.objectStoreNames.length!==1||!db.objectStoreNames.contains('state'))throw protectedError();
        }catch(error){finishError(error);}
      };
      request.onerror=()=>finishError(storageError());
      request.onsuccess=()=>{
        const db=request.result;
        try{
          operation.check();
          if(settled){db.close();return;}
          if(db.version!==1||db.objectStoreNames.length!==1||!db.objectStoreNames.contains('state'))throw protectedError();
          this.#connections.set(db,operation);
          db.onversionchange=()=>operation.cancel(conflictError());
          settled=true;operation.signal.removeEventListener('abort',abort);resolve(db);
        }catch(error){db.close();finishError(error);}
      };
    });
  }

  #transaction(db,mode,operation,candidate=null,expectedRevision=null){
    operation.check();
    return new Promise((resolve,reject)=>{
      let tx,settled=false,value,reason=null;
      const finish=error=>{
        if(settled)return;settled=true;operation.signal.removeEventListener('abort',abort);
        if(error)reject(error);else resolve(value);
      };
      const stop=error=>{
        if(settled)return;reason=error;
        try{tx.abort();}catch{/* A commit may already have happened; never claim rollback. */}
        finish(error);
      };
      const abort=()=>{try{operation.check();}catch(error){stop(error);}};
      try{tx=db.transaction('state',mode);}catch{reject(storageError());return;}
      operation.signal.addEventListener('abort',abort,{once:true});
      tx.onabort=()=>finish(reason??storageError());
      tx.onerror=()=>{reason??=storageError();};
      tx.oncomplete=()=>{
        try{operation.check();if(reason)throw reason;if(value===undefined)throw storageError();finish();}
        catch(error){finish(error);}
      };
      try{
        const store=tx.objectStore('state'),key=store.getKey('library'),row=store.get('library');
        let gotKey=false,gotRow=false;
        const admit=()=>{
          if(settled||!gotKey||!gotRow)return;
          try{
            operation.check();
            let current;
            if(key.result===undefined)current=emptyLibrary();
            else{
              try{current=validateLibrary(row.result);}catch{throw protectedError();}
            }
            if(candidate!==null){
              if(current.revision!==expectedRevision)throw conflictError();
              store.put(candidate,'library');value=candidate;
            }else value=current;
          }catch(error){stop(error);}
        };
        key.onsuccess=()=>{gotKey=true;admit();};row.onsuccess=()=>{gotRow=true;admit();};
      }catch(error){stop(error instanceof TakeError?error:storageError());}
    });
  }

  async #verify(snapshot,operation,stored=false){
    for(const record of snapshot.records){
      operation.check();
      let hash;
      try{hash=await sha256Blob(record.video,{signal:operation.signal});}
      catch(error){operation.check();throw stored?protectedError():error;}
      operation.check();
      if(hash!==record.metadata.video.sha256)throw stored?protectedError():failure('invalid','Take video bytes do not match their declared SHA-256.');
    }
    return snapshot;
  }

  read({signal}={}){
    return this.#operate(async operation=>{
      const db=await this.#open(operation);
      const snapshot=await this.#transaction(db,'readonly',operation);
      operation.check();
      return this.#verify(snapshot,operation,true);
    },signal);
  }

  save(candidate,{expectedRevision,signal}={}){
    if(this.#closed)return Promise.reject(closedError());
    let snapshot;
    try{
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision===Number.MAX_SAFE_INTEGER)throw failure('invalid','An exact current library revision is required before saving.');
      snapshot=validateLibrary(candidate);
      if(snapshot.revision!==expectedRevision+1)throw failure('invalid','The candidate library revision must be the expected revision plus one.');
    }catch(error){return Promise.reject(error);}
    return this.#operate(async operation=>{
      await this.#verify(snapshot,operation);
      const db=await this.#open(operation);
      // Complete async integrity checks before the atomic CAS transaction.
      const previous=await this.#transaction(db,'readonly',operation);
      await this.#verify(previous,operation,true);
      operation.check();
      const saved=await this.#transaction(db,'readwrite',operation,snapshot,expectedRevision);
      operation.check();return validateLibrary(saved);
    },signal);
  }

  close(){
    if(this.#closed)return;this.#closed=true;
    for(const operation of this.#operations)operation.cancel(closedError());
    for(const db of this.#connections.keys())this.#release(db);
  }
}
