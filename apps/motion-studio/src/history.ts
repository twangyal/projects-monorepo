import { validateProject } from './model.ts';
import type { Project } from './model.ts';

type Snapshot = { json: string; bytes: number };
const MAX_STATES = 30;
const MAX_BYTES = 20 * 1024 * 1024;

function snapshot(project: Project): Snapshot {
  const json = JSON.stringify(validateProject(project));
  return { json, bytes: new TextEncoder().encode(json).byteLength };
}

/** Immutable snapshots, branching redo, and a bounded serialized memory budget. */
export class History {
  private states: Snapshot[];
  private index = 0;

  constructor(project: Project) {
    this.states = [snapshot(project)];
  }

  get current(): Project { return JSON.parse(this.states[this.index].json) as Project; }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index + 1 < this.states.length; }

  commit(project: Project): boolean {
    const next = snapshot(project);
    if (next.json === this.states[this.index].json) return false;
    const retained = this.states.slice(0, this.index + 1);
    retained.push(next);
    let bytes = retained.reduce((total, entry) => total + entry.bytes, 0);
    while (retained.length > 1 && (retained.length > MAX_STATES || bytes > MAX_BYTES)) {
      bytes -= retained.shift()!.bytes;
    }
    this.states = retained;
    this.index = retained.length - 1;
    return true;
  }

  undo(): Project {
    if (this.canUndo) this.index--;
    return this.current;
  }
  redo(): Project {
    if (this.canRedo) this.index++;
    return this.current;
  }
  reset(project: Project): void {
    const initial = snapshot(project);
    this.states = [initial];
    this.index = 0;
  }
}
