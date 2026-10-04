import {createProject,importProject,validateProject} from './model.js';
export const DRAFT_KEY='shot-studio-v1';

// A failed startup read must never authorize an automatic overwrite.
export class DraftStore {
  constructor(getStorage=()=>globalThis.localStorage){
    this.getStorage=getStorage;this.project=createProject();this.blocked=false;this.raw=null;
    try{
      const raw=getStorage().getItem(DRAFT_KEY);
      if(raw!==null){this.raw=raw;this.project=importProject(raw);this.raw=null;}
    }catch{this.blocked=true;}
  }
  save(project){
    if(this.blocked)throw Error('The saved draft is protected. Save a project backup or explicitly replace the browser draft.');
    this.write(project);
  }
  replace(project){this.write(project);}
  write(project){
    const text=JSON.stringify(validateProject(project));
    this.getStorage().setItem(DRAFT_KEY,text);
    // Storage writes are atomic. Failed writes retain the recovery state.
    this.blocked=false;this.raw=null;
  }
}
