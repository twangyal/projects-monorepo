import {validateProject} from './model.js';
export class ProjectHistory{
  #state;#past=[];#future=[];
  constructor(project){this.#state=validateProject(project);}
  get current(){return structuredClone(this.#state);}
  get canUndo(){return this.#past.length>0;}
  get canRedo(){return this.#future.length>0;}
  commit(project){
    const next=validateProject(project);
    if(JSON.stringify(next)===JSON.stringify(this.#state))return this.current;
    this.#past.push(this.#state);if(this.#past.length>30)this.#past.shift();
    this.#state=next;this.#future=[];return this.current;
  }
  undo(){if(this.canUndo){this.#future.push(this.#state);this.#state=this.#past.pop();}return this.current;}
  redo(){if(this.canRedo){this.#past.push(this.#state);this.#state=this.#future.pop();}return this.current;}
}
export function moveShot(project,index,direction){
  const next=validateProject(project),target=index+direction;
  if(!Number.isInteger(index)||![-1,1].includes(direction)||index<0||index>=next.shots.length||target<0||target>=next.shots.length)throw Error('Cannot move this shot outside the cut.');
  [next.shots[index],next.shots[target]]=[next.shots[target],next.shots[index]];return next;
}
