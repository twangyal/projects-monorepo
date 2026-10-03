import { validateComposition } from './model.ts';
import type { Composition } from './types.ts';

/** Bounded session history; persistence stores only the current composition. */
export class CompositionHistory {
  readonly #limit: number;
  #snapshots: Composition[];
  #position = 0;

  constructor(initial: Composition, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('History limit must be an integer between 1 and 100.');
    }
    this.#limit = limit;
    this.#snapshots = [validateComposition(initial)];
  }

  get current(): Composition {
    return validateComposition(this.#snapshots[this.#position]);
  }

  get canUndo(): boolean {
    return this.#position > 0;
  }

  get canRedo(): boolean {
    return this.#position < this.#snapshots.length - 1;
  }

  commit(next: Composition): boolean {
    const snapshot = validateComposition(next);
    if (JSON.stringify(snapshot) === JSON.stringify(this.#snapshots[this.#position])) return false;

    this.#snapshots = this.#snapshots.slice(0, this.#position + 1);
    this.#snapshots.push(snapshot);
    if (this.#snapshots.length > this.#limit + 1) this.#snapshots.shift();
    this.#position = this.#snapshots.length - 1;
    return true;
  }

  undo(): Composition | null {
    if (!this.canUndo) return null;
    this.#position--;
    return this.current;
  }

  redo(): Composition | null {
    if (!this.canRedo) return null;
    this.#position++;
    return this.current;
  }
}
