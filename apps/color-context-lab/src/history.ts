import { LIMITS, type EditState, type ImageAsset, type Project } from './types.ts';
import { validateProject } from './model.ts';

interface Entry { json: string; bytes: number }
function entry(project: Project): Entry {
  const state: EditState = { title: project.title, settings: project.settings };
  const json = JSON.stringify(state);
  return { json, bytes: new TextEncoder().encode(json).length };
}
export class History {
  private id = '';
  private image!: ImageAsset;
  private entries: Entry[] = [];
  private index = 0;
  constructor(project: Project) { this.reset(project); }
  get current(): Project {
    const edit = JSON.parse(this.entries[this.index].json) as EditState;
    return { schemaVersion: 1, id: this.id, title: edit.title,
      image: { ...this.image, source: { ...this.image.source } }, settings: edit.settings };
  }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.entries.length - 1; }
  commit(project: Project): boolean {
    const candidate = validateProject(project);
    if (candidate.id !== this.id || JSON.stringify(candidate.image) !== JSON.stringify(this.image)) throw new Error('History edits must keep the same project and normalized image. Start new history after import.');
    const next = entry(candidate);
    if (next.json === this.entries[this.index].json) return false;
    const retained = this.entries.slice(0, this.index + 1); retained.push(next);
    let bytes = retained.reduce((sum, item) => sum + item.bytes, 0);
    while (retained.length > 1 && (retained.length > LIMITS.historyStates || bytes > LIMITS.historyBytes)) bytes -= retained.shift()!.bytes;
    this.entries = retained; this.index = retained.length - 1;
    return true;
  }
  undo(): Project { if (this.canUndo) this.index--; return this.current; }
  redo(): Project { if (this.canRedo) this.index++; return this.current; }
  reset(project: Project): void {
    const candidate = validateProject(project), first = entry(candidate);
    this.id = candidate.id; this.image = candidate.image; this.entries = [first]; this.index = 0;
  }
}
