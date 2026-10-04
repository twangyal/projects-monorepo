import { LIMITS, type Dataset, type EditState, type Notebook } from './types.ts';
import { validateNotebook } from './model.ts';

interface Entry { json: string; bytes: number }
function entry(notebook: Notebook): Entry {
  const { title, query, screen, watchlist, comparison, notes } = notebook;
  const json = JSON.stringify({ title, query, screen, watchlist, comparison, notes } satisfies EditState);
  return { json, bytes: new TextEncoder().encode(json).length };
}
export class NotebookHistory {
  private readonly id: string;
  private readonly datasetJson: string;
  private states: Entry[];
  private index = 0;
  constructor(notebook: Notebook, today: string) {
    const validated = validateNotebook(notebook, today);
    this.id = validated.id; this.datasetJson = JSON.stringify(validated.dataset);
    this.states = [entry(validated)];
  }
  private snapshot(index: number): Notebook {
    const state = JSON.parse(this.states[index].json) as EditState;
    return { schemaVersion: 1, id: this.id, dataset: JSON.parse(this.datasetJson) as Dataset, ...state };
  }
  get current(): Notebook { return this.snapshot(this.index); }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.states.length - 1; }
  commit(next: Notebook, today: string): void {
    const validated = validateNotebook(next, today);
    if (validated.id !== this.id || JSON.stringify(validated.dataset) !== this.datasetJson) throw new Error('History cannot replace the notebook or immutable dataset. Start new history after an import.');
    const nextEntry = entry(validated);
    if (nextEntry.json === this.states[this.index].json) return;
    const states = this.states.slice(0, this.index + 1); states.push(nextEntry);
    let bytes = states.reduce((sum, item) => sum + item.bytes, 0);
    while (states.length > 1 && (states.length > LIMITS.historyStates || bytes > LIMITS.historyBytes)) bytes -= states.shift()!.bytes;
    this.states = states; this.index = states.length - 1;
  }
  undo(today: string): Notebook {
    const next = Math.max(0, this.index - 1), candidate = validateNotebook(this.snapshot(next), today);
    this.index = next; return candidate;
  }
  redo(today: string): Notebook {
    const next = Math.min(this.states.length - 1, this.index + 1), candidate = validateNotebook(this.snapshot(next), today);
    this.index = next; return candidate;
  }
}
