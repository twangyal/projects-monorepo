import {createSequence,validateSequence,importSequence} from './sequence.js';
export const SEQUENCE_DRAFT_KEY='shot-studio-sequence-v1';

// Owns only the sequence record. Scene and take storage never pass through here.
export class SequenceDraftStore{
  #expected=null;
  constructor(getStorage=()=>globalThis.localStorage){
    this.getStorage=getStorage;this.sequence=createSequence();this.blocked=false;this.raw=null;
    try{
      const raw=getStorage().getItem(SEQUENCE_DRAFT_KEY);this.#expected=raw;
      if(raw!==null){this.raw=raw;this.sequence=importSequence(raw);this.raw=null;}
    }catch{this.blocked=true;}
  }
  save(sequence){
    if(this.blocked)throw Error('The saved sequence draft is protected. Download a sequence backup before explicitly replacing it.');
    const text=JSON.stringify(validateSequence(sequence)),storage=this.getStorage();
    const current=storage.getItem(SEQUENCE_DRAFT_KEY);
    if(current!==this.#expected){
      this.blocked=true;this.raw=current;
      throw Error('The sequence draft changed in another tab. Reload and review it before replacing the saved draft.');
    }
    this.#write(storage,text);
  }
  replace(sequence){this.#write(this.getStorage(),JSON.stringify(validateSequence(sequence)));}
  #write(storage,text){
    storage.setItem(SEQUENCE_DRAFT_KEY,text);
    this.#expected=text;this.blocked=false;this.raw=null;
  }
}
