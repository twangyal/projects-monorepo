import { validateProject } from './model.ts';
import { LIMITS } from './types.ts';
import type { EditState, Project } from './types.ts';

export class History {
  #project: Project;
  #edits: EditState[];
  #index = 0;
  constructor(project: Project) { this.#project = validateProject(project); this.#edits = [this.#edit(this.#project)]; }
  #edit(p: Project): EditState { return { title:p.title, settings: { ...p.settings } }; }
  get current(): Project { return validateProject({ ...this.#project, ...this.#edits[this.#index] }); }
  get canUndo(): boolean { return this.#index > 0; }
  get canRedo(): boolean { return this.#index < this.#edits.length-1; }
  commit(project: Project): boolean {
    const p = validateProject(project);
    if (p.id !== this.#project.id || JSON.stringify(p.image) !== JSON.stringify(this.#project.image)) throw new Error('History cannot replace the image/project');
    const edit = this.#edit(p);
    if (JSON.stringify(edit) === JSON.stringify(this.#edits[this.#index])) return false;
    const edits = [...this.#edits.slice(0,this.#index+1),edit];
    while (edits.length > LIMITS.historyStates || new TextEncoder().encode(JSON.stringify(edits)).length > LIMITS.historyBytes) edits.shift();
    this.#edits = edits; this.#index = edits.length-1;
    return true;
  }
  undo(): Project { if (this.canUndo) this.#index--; return this.current; }
  redo(): Project { if (this.canRedo) this.#index++; return this.current; }
  reset(project: Project): void {
    const p = validateProject(project); this.#project = p; this.#edits = [this.#edit(p)]; this.#index = 0;
  }
}
