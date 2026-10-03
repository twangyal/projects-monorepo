import { LIMITS, type Project } from './types.ts';
import { serializeProject } from './domain.ts';

interface Snapshot { text: string; bytes: number }

function snapshot(project: Project): Snapshot {
  const text = serializeProject(project);
  return { text, bytes: new TextEncoder().encode(text).byteLength };
}

export class ProjectHistory {
  #snapshots: Snapshot[];
  #index = 0;
  #bytes: number;

  constructor(initial: Project) {
    const first = snapshot(initial);
    this.#snapshots = [first]; this.#bytes = first.bytes;
  }

  get current(): Project {
    // Retained strings were validated when captured; parsing returns a fresh
    // object without exposing any of the history's state to the caller.
    return JSON.parse(this.#snapshots[this.#index].text) as Project;
  }

  get canUndo(): boolean { return this.#index > 0; }
  get canRedo(): boolean { return this.#index + 1 < this.#snapshots.length; }

  apply(next: Project): boolean {
    const captured = snapshot(next);
    if (captured.text === this.#snapshots[this.#index].text) return false;
    for (const discarded of this.#snapshots.splice(this.#index + 1)) this.#bytes -= discarded.bytes;
    this.#snapshots.push(captured); this.#bytes += captured.bytes;
    this.#index = this.#snapshots.length - 1;
    while (this.#snapshots.length > 1 &&
      (this.#snapshots.length > LIMITS.historySnapshots || this.#bytes > LIMITS.historyBytes)) {
      this.#bytes -= this.#snapshots.shift()!.bytes; this.#index--;
    }
    return true;
  }

  undo(): Project | null {
    if (!this.canUndo) return null;
    this.#index--; return this.current;
  }

  redo(): Project | null {
    if (!this.canRedo) return null;
    this.#index++; return this.current;
  }
}
