import {createSequence,validateSequence,importSequence} from './sequence.js';

export const SEQUENCE_DRAFT_KEY='shot-studio-sequence-v1';
const MAX_PRIOR=30,MAX_RAW_BYTES=1024*1024,MAX_RECOVERY_BYTES=2*1024*1024;
const encoder=new TextEncoder();

function snapshot(document){return JSON.stringify(validateSequence(document));}

export class SequenceHistory{
  #states;#index=0;
  constructor(document){this.#states=[snapshot(document)];}
  get current(){return JSON.parse(this.#states[this.#index]);}
  get canUndo(){return this.#index>0;}
  get canRedo(){return this.#index+1<this.#states.length;}
  commit(document){
    // Admit the whole new state before touching either cursor or redo branch.
    const next=snapshot(document);
    if(next===this.#states[this.#index])return this.current;
    const retained=this.#states.slice(0,this.#index+1);
    retained.push(next);
    if(retained.length>MAX_PRIOR+1)retained.shift();
    this.#states=retained;this.#index=retained.length-1;
    return this.current;
  }
  undo(){if(this.canUndo)this.#index--;return this.current;}
  redo(){if(this.canRedo)this.#index++;return this.current;}
}

export class SequenceDraftStore{
  #expected;#known=false;
  constructor(getStorage=()=>globalThis.localStorage){
    this.getStorage=getStorage;this.sequence=createSequence();this.blocked=false;this.raw=null;
    try{
      const raw=getStorage().getItem(SEQUENCE_DRAFT_KEY);
      if(raw!==null&&typeof raw!=='string')throw Error('Saved sequence storage did not return text.');
      this.#expected=raw;this.#known=true;
      if(raw!==null){
        this.raw=raw;this.sequence=importSequence(raw);this.raw=null;
      }
    }catch{this.blocked=true;}
  }
  save(sequence){
    if(this.blocked)throw Error('The saved sequence is protected. Save a sequence backup or explicitly replace the saved sequence.');
    this.#write(sequence);
  }
  replace(sequence){this.#write(sequence);}
  #write(sequence){
    const safe=validateSequence(sequence),text=JSON.stringify(safe);
    let storage,current;
    try{
      storage=this.getStorage();current=storage.getItem(SEQUENCE_DRAFT_KEY);
      if(current!==null&&typeof current!=='string')throw Error('Saved sequence storage did not return text.');
    }catch{
      // An unreadable record is not proven absent and cannot authorize a write.
      this.#known=false;this.blocked=true;this.raw=null;
      throw Error('The saved sequence could not be read. Existing storage is protected. Retry and review it before replacement.');
    }
    if(!this.#known||current!==this.#expected){
      // Observe the foreign record without adopting it as the working sequence.
      // A later deliberate replacement must still match these reviewed bytes.
      this.#expected=current;this.#known=true;this.blocked=true;this.raw=current;
      throw Error('The saved sequence changed or was not previously readable. Review the current saved record before explicitly replacing it.');
    }
    // This optimistic freshness check does not make localStorage a cross-tab
    // transaction. setItem itself is atomic; failure does not advance receipt.
    storage.setItem(SEQUENCE_DRAFT_KEY,text);
    this.#expected=text;this.#known=true;
    this.sequence=safe;this.blocked=false;this.raw=null;
  }
  recoveryJson(){
    if(typeof this.raw!=='string')throw Error('No known unreadable sequence text is available. A failed read has no raw recovery download.');
    const raw=this.raw;
    if(raw.length>MAX_RAW_BYTES||encoder.encode(raw).byteLength>MAX_RAW_BYTES){
      throw Error('Unreadable sequence text exceeds the 1 MiB recovery byte limit. Existing data stays protected.');
    }
    const envelope=JSON.stringify({kind:'shot-studio-sequence-recovery',raw});
    if(envelope.length>MAX_RECOVERY_BYTES||encoder.encode(envelope).byteLength>MAX_RECOVERY_BYTES){
      throw Error('Escaped sequence recovery exceeds the 2 MiB byte limit. Existing data stays protected.');
    }
    return envelope;
  }
}
