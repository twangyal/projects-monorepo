import { LIMITS, type EditState, type PhotoAsset, type Project } from './types.ts';
import { validateProject } from './model.ts';

interface Entry { json: string; bytes: number }
function entry(project: Project): Entry {
  const { title, settings, depth } = project;
  const json = JSON.stringify({ title, settings, depth } satisfies EditState);
  return { json, bytes: new TextEncoder().encode(json).length };
}

export class History {
  private id!: string;
  private photo!: PhotoAsset;
  private entries: Entry[] = [];
  private index = 0;
  constructor(project: Project) { this.reset(project); }
  get current(): Project {
    const edit = JSON.parse(this.entries[this.index].json) as EditState;
    return { schemaVersion: 1, id: this.id, photo: { ...this.photo }, ...edit };
  }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.entries.length - 1; }
  commit(project: Project): boolean {
    const validated = validateProject(project);
    if (validated.id !== this.id || validated.photo.id !== this.photo.id || validated.photo.dataUrl !== this.photo.dataUrl
      || validated.photo.width !== this.photo.width || validated.photo.height !== this.photo.height) {
      throw new Error('History commits must keep the same project and photo. Reset history after importing.');
    }
    const next = entry(validated);
    if (next.json === this.entries[this.index].json) return false;
    const retained = this.entries.slice(0, this.index + 1);
    retained.push(next);
    let bytes = retained.reduce((sum, item) => sum + item.bytes, 0);
    while (retained.length > 1 && (retained.length > LIMITS.historyStates || bytes > LIMITS.historyBytes)) bytes -= retained.shift()!.bytes;
    this.entries = retained; this.index = retained.length - 1;
    return true;
  }
  undo(): Project { if (this.canUndo) this.index--; return this.current; }
  redo(): Project { if (this.canRedo) this.index++; return this.current; }
  reset(project: Project): void {
    const validated = validateProject(project), first = entry(validated);
    this.id = validated.id; this.photo = validated.photo;
    this.entries = [first]; this.index = 0;
  }
}
